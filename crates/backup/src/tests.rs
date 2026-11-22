use super::*;
use manifest::{Entry, Manifest};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::TcpListener,
    thread,
};
use tempfile::tempdir;

fn entry(file: &str, object: &str, data: &[u8]) -> Entry {
    Entry {
        file: file.into(),
        object_path: Some(object.into()),
        content_type: Some("image/png".into()),
        updated_at: None,
        bytes: data.len() as u64,
        sha256: format!("{:x}", Sha256::digest(data)),
    }
}
#[test]
fn database_connection() {
    let s = "postgresql://postgres.ref:s%40fe%3Asecret@example.test:5432/postgres";
    let cfg = database::connection(s).unwrap();
    assert_eq!(cfg["PGPASSWORD"], "s@fe:secret");
    assert_eq!(cfg["PGUSER"], "postgres.ref");
    assert_eq!(cfg["PGSSLMODE"], "require");
    assert!(!cfg.contains_key("DATABASE_URL"));
    assert!(database::connection(&format!("{s}?sslmode=disable")).is_err());
    assert!(database::connection(&s.replace(":5432", ":6543")).is_err());
}
#[test]
fn file_validation() {
    let dir = tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    for invalid in [
        "../secret",
        "owner/../secret",
        "/root",
        "owner\\secret",
        "owner//file",
    ] {
        assert!(manifest::validate_path(invalid).is_err());
        assert!(manifest::local_file(&root, invalid).is_err());
    }
    let mut m = Manifest::new("database");
    m.publish(&root).unwrap();
    assert!(manifest::verify(&root).is_err());
    assert!(m.publish(&root).is_err());
    fs::remove_file(root.join("manifest.json")).unwrap();
    m.kind = "media".into();
    m.files = vec![
        entry("a", "owner/photo.png", b"one"),
        entry("b", "owner/photo.png", b"two"),
    ];
    fs::write(root.join("a"), b"one").unwrap();
    fs::write(root.join("b"), b"two").unwrap();
    m.publish(&root).unwrap();
    assert!(
        manifest::verify(&root)
            .unwrap_err()
            .to_string()
            .contains("repeated storage object")
    );
}
struct Reply {
    method: &'static str,
    path: &'static str,
    body: Vec<u8>,
    status: u16,
    expected: Option<serde_json::Value>,
}
fn page(prefix: &str, offset: usize, items: serde_json::Value) -> Reply {
    Reply {
        method: "POST",
        path: "/storage/v1/object/list/tracker-images",
        body: items.to_string().into_bytes(),
        status: 200,
        expected: Some(serde_json::json!({"prefix":prefix,"offset":offset})),
    }
}
fn server(replies: Vec<Reply>) -> (media::Storage, thread::JoinHandle<()>) {
    let server = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = server.local_addr().unwrap();
    let worker = thread::spawn(move || {
        for r in replies {
            let (mut socket, _) = server.accept().unwrap();
            let mut reader = BufReader::new(&socket);
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            assert_eq!(line.trim(), format!("{} {} HTTP/1.1", r.method, r.path));
            let mut len = 0;
            let mut auth = false;
            loop {
                line.clear();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
                let (key, value) = line.split_once(':').unwrap();
                match key.to_lowercase().as_str() {
                    "content-length" => len = value.trim().parse().unwrap(),
                    "authorization" => auth = value.trim() == "Bearer fixture-only",
                    "x-upsert" => assert_eq!(value.trim(), "false"),
                    _ => (),
                }
            }
            assert!(auth);
            let mut body = vec![0; len];
            reader.read_exact(&mut body).unwrap();
            if let Some(fields) = r.expected {
                let sent: serde_json::Value = serde_json::from_slice(&body).unwrap();
                for (key, value) in fields.as_object().unwrap() {
                    assert_eq!(&sent[key], value)
                }
            } else if r.method == "POST" {
                assert_eq!(body, b"image")
            }
            write!(socket,"HTTP/1.1 {} Test\r\nContent-Length: {}\r\nContent-Type: image/png\r\nConnection: close\r\n\r\n",r.status,r.body.len()).unwrap();
            socket.write_all(&r.body).unwrap();
        }
    });
    (
        media::Storage::new(
            format!("http://{addr}").parse().unwrap(),
            "testref".into(),
            "fixture-only".into(),
        )
        .unwrap(),
        worker,
    )
}
fn image(method: &'static str, status: u16) -> Reply {
    Reply {
        method,
        path: "/storage/v1/object/tracker-images/owner/image.png",
        status,
        body: b"image".to_vec(),
        expected: None,
    }
}
#[test]
fn nested_backup_restore_integrity() {
    let folder = serde_json::json!([{"id":null,"name":"owner"}]);
    let file = serde_json::json!([{"id":"1","name":"image.png","metadata":{"size":5}}]);
    let dir = tempdir().unwrap();
    let (storage, worker) = server(vec![
        page("", 0, folder),
        page("owner", 0, file),
        image("GET", 200),
        image("POST", 200),
    ]);
    assert_eq!(storage.backup(dir.path()).unwrap(), 1);
    assert!(
        !fs::read_to_string(dir.path().join("manifest.json"))
            .unwrap()
            .contains("fixture-only")
    );
    assert_eq!(storage.restore(dir.path(), false, None, false).unwrap(), 1);
    assert!(
        storage
            .restore(dir.path(), true, Some("other"), false)
            .is_err()
    );
    assert_eq!(
        storage
            .restore(dir.path(), true, Some("testref"), false)
            .unwrap(),
        1
    );
    worker.join().unwrap();
    fs::write(dir.path().join("files/000000.bin"), b"other").unwrap();
    assert!(
        manifest::verify(dir.path())
            .unwrap_err()
            .to_string()
            .contains("integrity")
    );
}
#[test]
fn listing_paginates_and_failed_download_does_not_publish() {
    let dir = tempdir().unwrap();
    let full = (0..100)
        .map(|i| serde_json::json!({"id":i.to_string(),"name":format!("{i}.png")}))
        .collect::<Vec<_>>();
    let (storage, worker) = server(vec![
        page("", 0, serde_json::json!(full)),
        page("", 100, serde_json::json!([])),
        Reply {
            method: "GET",
            path: "/storage/v1/object/tracker-images/0.png",
            status: 403,
            body: vec![],
            expected: None,
        },
    ]);
    assert!(
        storage
            .backup(dir.path())
            .unwrap_err()
            .to_string()
            .contains("HTTP 403")
    );
    worker.join().unwrap();
    assert!(!dir.path().join("manifest.json").exists());
}
