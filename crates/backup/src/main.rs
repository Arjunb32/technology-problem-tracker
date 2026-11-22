mod database;
mod manifest;
mod media;
use anyhow::{Result, anyhow, bail, ensure};
use std::{
    collections::HashMap,
    env, fs,
    path::{Path, PathBuf},
    process::ExitCode,
};
use uuid::Uuid;

fn timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
fn env_value(key: &str) -> Result<String> {
    env::var(key)
        .ok()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow!("Set {key} in the owner shell environment."))
}
fn new_dir(out: Option<&String>, kind: &str) -> Result<PathBuf> {
    let parent = env::current_dir()?.join(out.map(String::as_str).unwrap_or("backups"));
    fs::create_dir_all(&parent)?;
    let dir = parent.join(format!(
        "{}-{}-{}",
        kind,
        timestamp().replace([':', '.'], "-"),
        &Uuid::new_v4().simple().to_string()[..8]
    ));
    let builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        let mut builder = builder;
        builder.mode(0o700).create(&dir)?;
    }
    #[cfg(not(unix))]
    builder.create(&dir)?;
    Ok(dir)
}
fn run() -> Result<()> {
    let mut args = env::args().skip(1);
    let command = args.next().unwrap_or_default();
    let (options, usage) = match command.as_str() {
        "verify-backup" => (&["dir"][..], "--dir BACKUP_DIRECTORY"),
        "backup-db" | "backup-media" => (&["out"][..], "[--out INDEPENDENT_STORAGE_FOLDER]"),
        "restore-media" => (
            &["dir", "apply", "confirm-ref", "overwrite"][..],
            "--dir BACKUP_DIRECTORY [--apply --confirm-ref TARGET_PROJECT_REF] [--overwrite]",
        ),
        "--help" | "-h" => {
            println!(
                "Usage: tracker-backup <backup-db|backup-media|verify-backup|restore-media> [options]"
            );
            return Ok(());
        }
        _ => bail!("Unknown command. Use --help."),
    };
    let mut flags = HashMap::new();
    while let Some(arg) = args.next() {
        let name = arg.strip_prefix("--").unwrap_or_default();
        ensure!(
            name == "help" || options.contains(&name),
            "Unknown command option. Use --help."
        );
        let value = if ["help", "apply", "overwrite"].contains(&name) {
            String::new()
        } else {
            args.next()
                .filter(|s| !s.is_empty() && !s.starts_with("--"))
                .ok_or_else(|| anyhow!("Missing value for --{name}."))?
        };
        flags.insert(name.to_owned(), value);
    }
    if flags.contains_key("help") {
        println!("Usage: tracker-backup {command} {usage}");
        return Ok(());
    }
    let directory = || {
        flags
            .get("dir")
            .map(Path::new)
            .ok_or_else(|| anyhow!("Supply --dir BACKUP_DIRECTORY."))
    };
    match command.as_str() {
        "verify-backup" => {
            let m = manifest::verify(directory()?)?;
            println!(
                "Verified {} backup: {} files match their sizes and SHA-256 checksums. This does not replace a restore drill.",
                m.kind,
                m.files.len()
            );
        }
        "backup-db" => {
            let config = database::connection(&env::var("DATABASE_URL").unwrap_or_default())?;
            let dir = new_dir(flags.get("out"), "database")?;
            database::backup(&dir, &config)?;
            println!(
                "Database export complete: {}\nNext: verify-backup, copy to independent protected storage, and perform a disposable-project restore drill.",
                dir.display()
            );
        }
        "backup-media" => {
            let storage = media::Storage::from_env()?;
            let dir = new_dir(flags.get("out"), "media")?;
            let count = storage.backup(&dir)?;
            println!(
                "Media backup complete: {count} objects in {}\nVerify and copy to independent protected storage. No remote objects were changed.",
                dir.display()
            );
        }
        "restore-media" => {
            let dir = directory()?;
            let storage = media::Storage::from_env()?;
            let apply = flags.contains_key("apply");
            let overwrite = flags.contains_key("overwrite");
            let count = storage.restore(
                dir,
                apply,
                flags.get("confirm-ref").map(String::as_str),
                overwrite,
            )?;
            println!(
                "{} {count} objects. Target project: {}. Overwrite: {}.",
                if apply {
                    "Restored"
                } else {
                    "Dry run verified"
                },
                storage.project,
                if overwrite { "enabled" } else { "disabled" }
            );
            if !apply {
                println!(
                    "No remote writes occurred. Review the target and use --apply --confirm-ref TARGET_PROJECT_REF only when ready."
                );
            }
        }
        _ => unreachable!(),
    }
    Ok(())
}
fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("{e}");
            ExitCode::FAILURE
        }
    }
}
#[cfg(test)]
mod tests;
