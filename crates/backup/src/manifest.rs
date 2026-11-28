use anyhow::{Result, bail, ensure};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub file: String,
    pub bytes: u64,
    pub sha256: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub object_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub version: u32,
    pub complete: bool,
    pub kind: String,
    pub files: Vec<Entry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bucket: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schemas: Option<Vec<String>>,
}

impl Manifest {
    pub fn new(kind: &str) -> Self {
        Self {
            version: 1,
            complete: true,
            kind: kind.into(),
            files: Vec::new(),
            bucket: None,
            created_at: Some(super::timestamp()),
            project_ref: None,
            schemas: None,
        }
    }
    pub fn publish(&self, dir: &Path) -> Result<()> {
        let mut file = tempfile::NamedTempFile::new_in(dir)?;
        serde_json::to_writer_pretty(&mut file, self)?;
        file.write_all(b"\n")?;
        file.as_file().sync_all()?;
        file.persist_noclobber(dir.join("manifest.json"))?;
        Ok(())
    }
}

pub fn private_file(path: &Path) -> Result<File> {
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    Ok(options.open(path)?)
}

pub fn validate_path(name: &str) -> Result<()> {
    ensure!(
        !name.contains('\\')
            && !name
                .split('/')
                .any(|p| matches!(p, "" | "." | "..") || p.bytes().any(|b| b < 32)),
        "Unsafe object path in backup."
    );
    Ok(())
}

pub fn local_file(root: &Path, name: &str) -> Result<PathBuf> {
    ensure!(
        validate_path(name).is_ok() && !name.contains(':'),
        "Unsafe local file in manifest."
    );
    let absolute = root.join(name).canonicalize()?;
    ensure!(
        absolute.starts_with(root),
        "Backup file resolves outside its directory."
    );
    Ok(absolute)
}

pub fn copy_digest(mut input: impl Read, mut output: impl Write) -> Result<(u64, String)> {
    let mut hash = Sha256::new();
    let mut count = 0;
    let mut buffer = vec![0u8; 128 * 1024];
    loop {
        let n = match input.read(&mut buffer) {
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            result => result?,
        };
        if n == 0 {
            break;
        }
        output.write_all(&buffer[..n])?;
        hash.update(&buffer[..n]);
        count += n as u64;
    }
    Ok((count, format!("{:x}", hash.finalize())))
}

pub fn verify(dir: &Path) -> Result<Manifest> {
    let root = dir.canonicalize()?;
    let contents = fs::read(local_file(&root, "manifest.json")?)?;
    let manifest: Manifest = serde_json::from_slice(&contents).map_err(|e| {
        if e.is_syntax() || e.is_eof() {
            anyhow::anyhow!("Invalid backup manifest JSON.")
        } else {
            anyhow::anyhow!("Manifest is invalid or backup is incomplete.")
        }
    })?;
    ensure!(
        manifest.version == 1
            && manifest.complete
            && matches!(manifest.kind.as_str(), "database" | "media"),
        "Manifest is invalid or backup is incomplete."
    );
    let mut names = HashSet::new();
    let mut destinations = HashSet::new();
    for entry in &manifest.files {
        ensure!(
            entry.sha256.len() == 64
                && entry
                    .sha256
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
            "Manifest file metadata is invalid."
        );
        ensure!(
            names.insert(entry.file.as_str()),
            "Manifest contains a repeated local file."
        );
        if manifest.kind == "media" {
            let name = entry.object_path.as_deref().unwrap_or_default();
            validate_path(name)?;
            ensure!(
                destinations.insert(name),
                "Manifest contains a repeated storage object."
            );
        }
        let file = File::open(local_file(&root, &entry.file)?)?;
        let meta = file.metadata()?;
        if !meta.is_file()
            || meta.len() != entry.bytes
            || copy_digest(file, std::io::sink())? != (entry.bytes, entry.sha256.clone())
        {
            bail!("Backup integrity check failed: a file is missing, damaged, or changed.");
        }
    }
    ensure!(
        manifest.kind != "database"
            || (names.len() == 2 && names.contains("schema.dump") && names.contains("data.dump")),
        "Database backup is missing required dumps."
    );
    Ok(manifest)
}
