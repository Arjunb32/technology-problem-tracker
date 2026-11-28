use crate::manifest::{
    Entry, Manifest, copy_digest, local_file, private_file, validate_path, verify,
};
use anyhow::{Result, anyhow, ensure};
use reqwest::{
    Url,
    blocking::{Client, RequestBuilder, Response},
    redirect::Policy,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, fs, io::Write, path::Path, time::Duration};

const BUCKET: &str = "tracker-images";
pub struct Storage {
    base: Url,
    key: String,
    pub project: String,
    client: Client,
}

impl Storage {
    pub fn from_env() -> Result<Self> {
        let error = || anyhow!("SUPABASE_URL must be a hosted HTTPS Supabase project URL.");
        let base =
            Url::parse(&std::env::var("SUPABASE_URL").unwrap_or_default()).map_err(|_| error())?;
        let project = base
            .host_str()
            .and_then(|h| h.strip_suffix(".supabase.co"))
            .filter(|s| {
                !s.is_empty()
                    && s.bytes()
                        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
            })
            .ok_or_else(error)?
            .to_owned();
        ensure!(
            base.scheme() == "https"
                && base.username().is_empty()
                && base.password().is_none()
                && base.port().is_none()
                && base.query().is_none()
                && base.fragment().is_none()
                && base.path() == "/",
            error()
        );
        let key = crate::env_value("SUPABASE_SERVICE_ROLE_KEY")?;
        Self::new(base, project, key)
    }
    pub(super) fn new(base: Url, project: String, key: String) -> Result<Self> {
        Ok(Self {
            base,
            project,
            key,
            client: Client::builder()
                .timeout(Duration::from_secs(120))
                .redirect(Policy::none())
                .build()?,
        })
    }
    fn object_url(&self, name: &str) -> Result<Url> {
        validate_path(name)?;
        let mut url = self.base.join(&format!("storage/v1/object/{BUCKET}/"))?;
        url.path_segments_mut()
            .expect("HTTP URL")
            .pop_if_empty()
            .extend(name.split('/'));
        Ok(url)
    }
    fn send(&self, req: RequestBuilder) -> Result<Response> {
        let res = req
            .header("apikey", &self.key)
            .bearer_auth(&self.key)
            .send()
            .map_err(|_| {
                anyhow!(
                    "Storage request failed or timed out. Partial output is not a valid backup."
                )
            })?;
        ensure!(
            res.status().is_success(),
            "Storage request failed (HTTP {}). Check access and project availability.",
            res.status().as_u16()
        );
        Ok(res)
    }
    fn list(
        &self,
        prefix: &str,
        seen: &mut HashSet<String>,
        items: &mut Vec<(String, Object)>,
        page_size: usize,
    ) -> Result<()> {
        let url = self
            .base
            .join(&format!("storage/v1/object/list/{BUCKET}"))?;
        for offset in (0..).step_by(page_size) {
            let page:Vec<Object>=self.send(self.client.post(url.clone()).json(&json!({"prefix":prefix,"limit":page_size,"offset":offset,"sortBy":{"column":"name","order":"asc"}})))?.json().map_err(|_|anyhow!("Storage returned an invalid list."))?;
            let last = page.len() < page_size;
            for item in page {
                ensure!(!item.name.contains('/'), "Storage returned an unsafe name.");
                let path = if prefix.is_empty() {
                    item.name.clone()
                } else {
                    format!("{prefix}/{}", item.name)
                };
                validate_path(&path)?;
                ensure!(
                    seen.insert(path.clone()),
                    "Storage listing changed during backup. Run again during a quiet period."
                );
                if item.id.is_null() {
                    self.list(&path, seen, items, page_size)?;
                } else {
                    ensure!(
                        item.id.is_string(),
                        "Storage returned invalid object metadata."
                    );
                    items.push((path, item));
                }
            }
            if last {
                break;
            }
        }
        Ok(())
    }
    pub fn backup(&self, dir: &Path) -> Result<usize> {
        let mut objects = Vec::new();
        self.list("", &mut HashSet::new(), &mut objects, 100)?;
        fs::create_dir(dir.join("files"))?;
        let mut manifest = Manifest::new("media");
        manifest.bucket = Some(BUCKET.into());
        manifest.project_ref = Some(self.project.clone());
        for (i, (path, item)) in objects.into_iter().enumerate() {
            let res = self.send(self.client.get(self.object_url(&path)?))?;
            let content_type = res
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .or(item.metadata["mimetype"].as_str())
                .unwrap_or("application/octet-stream")
                .to_owned();
            let file = format!("files/{i:06}.bin");
            let mut target = private_file(&dir.join(&file))?;
            let (bytes, sha256) = copy_digest(res, &mut target)?;
            ensure!(
                item.metadata["size"]
                    .as_u64()
                    .is_none_or(|size| size == bytes),
                "Storage object changed during backup. Run again during a quiet period."
            );
            target.flush()?;
            target.sync_all()?;
            manifest.files.push(Entry {
                file,
                bytes,
                sha256,
                object_path: Some(path),
                content_type: Some(content_type),
                updated_at: item.updated_at,
            });
        }
        manifest.publish(dir)?;
        Ok(manifest.files.len())
    }
    pub fn restore(
        &self,
        dir: &Path,
        apply: bool,
        confirm: Option<&str>,
        overwrite: bool,
    ) -> Result<usize> {
        let root = dir.canonicalize()?;
        let manifest = verify(&root)?;
        ensure!(
            manifest.kind == "media" && manifest.bucket.as_deref() == Some(BUCKET),
            "This is not a tracker-images media backup."
        );
        if apply {
            ensure!(
                confirm == Some(&self.project),
                "Restore requires --confirm-ref equal to the target SUPABASE_URL project reference."
            );
            for entry in &manifest.files {
                let data = fs::read(local_file(&root, &entry.file)?)?;
                ensure!(
                    data.len() as u64 == entry.bytes
                        && format!("{:x}", Sha256::digest(&data)) == entry.sha256,
                    "Backup changed during restore."
                );
                let url = self.object_url(entry.object_path.as_deref().unwrap_or_default())?;
                self.send(
                    self.client
                        .post(url)
                        .header(
                            "Content-Type",
                            entry
                                .content_type
                                .as_deref()
                                .filter(|s| !s.is_empty())
                                .unwrap_or("application/octet-stream"),
                        )
                        .header("x-upsert", overwrite.to_string())
                        .body(data),
                )?;
            }
        }
        Ok(manifest.files.len())
    }
}

#[derive(Deserialize)]
struct Object {
    id: Value,
    name: String,
    #[serde(default)]
    metadata: Value,
    updated_at: Option<String>,
}
