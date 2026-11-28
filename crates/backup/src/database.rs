use super::manifest::{Entry, Manifest, copy_digest};
use anyhow::{Result, anyhow, ensure};
use percent_encoding::percent_decode_str;
use std::{
    collections::BTreeMap,
    fs::File,
    path::Path,
    process::{Command, Stdio},
};
use url::Url;

pub fn connection(input: &str) -> Result<BTreeMap<&'static str, String>> {
    let db = Url::parse(input).map_err(|_| {
        anyhow!("DATABASE_URL must be a PostgreSQL direct or session-pooler connection URL.")
    })?;
    ensure!(
        matches!(db.scheme(), "postgres" | "postgresql")
            && db.host_str().is_some()
            && !db.username().is_empty()
            && db.password().is_some_and(|p| !p.is_empty()),
        "DATABASE_URL must include a PostgreSQL host, user, and password."
    );
    ensure!(
        db.port() != Some(6543),
        "Use a direct connection or session pooler on port 5432, not the transaction pooler."
    );
    let ssl = db
        .query_pairs()
        .find(|(k, _)| k == "sslmode")
        .map(|(_, v)| v.into_owned())
        .unwrap_or_else(|| "require".into());
    ensure!(
        matches!(ssl.as_str(), "require" | "verify-ca" | "verify-full"),
        "DATABASE_URL must require TLS."
    );
    let decode =
        |s: &str| -> Result<String> { Ok(percent_decode_str(s).decode_utf8()?.into_owned()) };
    let database = db.path().trim_start_matches('/');
    Ok(BTreeMap::from([
        (
            "PGHOST",
            db.host_str().unwrap().trim_matches(['[', ']']).into(),
        ),
        ("PGUSER", decode(db.username())?),
        ("PGPASSWORD", decode(db.password().unwrap())?),
        ("PGPORT", db.port().unwrap_or(5432).to_string()),
        (
            "PGDATABASE",
            decode(if database.is_empty() {
                "postgres"
            } else {
                database
            })?,
        ),
        ("PGSSLMODE", ssl),
        ("PGCONNECT_TIMEOUT", "20".into()),
        ("PGOPTIONS", String::new()),
    ]))
}

pub fn backup(dir: &Path, env: &BTreeMap<&str, String>) -> Result<()> {
    let bin = std::env::var_os("PG_DUMP_BIN")
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "pg_dump".into());
    let mut manifest = Manifest::new("database");
    manifest.schemas = Some(vec!["public".into(), "auth data".into()]);
    for (name, flags) in [
        ("schema.dump", &["--schema=public", "--schema-only"][..]),
        (
            "data.dump",
            &[
                "--no-acl",
                "--schema=public",
                "--schema=auth",
                "--data-only",
            ][..],
        ),
    ] {
        let path = dir.join(name);
        let mut cmd = Command::new(&bin);
        cmd.env_remove("DATABASE_URL")
            .envs(env)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .args(["--format=custom", "--no-owner", "--lock-wait-timeout=30s"])
            .args(flags)
            .arg("--file")
            .arg(&path);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        let result=cmd.status().map_err(|_|anyhow!("PostgreSQL utility could not start. Install a matching PostgreSQL client or set PG_DUMP_BIN."))?;
        ensure!(
            result.success(),
            "PostgreSQL export failed. Check connection, permissions, and client/server versions. Partial output is not a valid backup."
        );
        let (bytes, sha256) = copy_digest(File::open(path)?, std::io::sink())?;
        manifest.files.push(Entry {
            file: name.into(),
            bytes,
            sha256,
            object_path: None,
            content_type: None,
            updated_at: None,
        });
    }
    manifest.publish(dir)
}
