use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::Serialize;
use wasm_bindgen::prelude::*;

#[derive(Serialize)]
pub struct Route<'a> {
    pub op: &'static str,
    pub id: &'a str,
    pub schema: Option<&'static str>,
    pub private: bool,
    pub status: u16,
}
pub fn lookup<'a>(method: &str, path: &'a str, demo: bool) -> Option<Route<'a>> {
    if method == "GET" && path == "/health" {
        return Some(Route {
            op: "health",
            id: "",
            schema: None,
            private: false,
            status: 200,
        });
    }
    let segments = path
        .strip_prefix("/api/v1/")?
        .split('/')
        .collect::<Vec<_>>();
    if segments.contains(&"") {
        return None;
    }
    let (op, id, schema, private, status) = match (method, segments.as_slice()) {
        ("GET", ["config"]) => ("config", "", None, false, 200),
        ("GET", ["openapi.json"]) => ("openapi", "", None, false, 200),
        ("POST", ["auth", "demo"]) if demo => ("demo", "", Some("demo"), false, 200),
        ("GET", ["me"]) => ("me", "", None, true, 200),
        ("PATCH", ["me"]) => ("updateProfile", "", Some("profile"), true, 200),
        ("GET", ["me", "following"]) => ("following", "", None, true, 200),
        ("GET", ["me", "notifications"]) => ("notifications", "", None, true, 200),
        ("PATCH", ["me", "notifications", id] | ["notifications", id]) => {
            ("markNotification", *id, Some("read"), true, 200)
        }
        ("GET", ["profiles", id]) => ("publicProfile", *id, None, false, 200),
        ("GET", ["problems"]) => ("feed", "", None, false, 200),
        ("GET", ["problems", id]) => ("detail", *id, None, false, 200),
        ("POST", ["problems"]) => ("createProblem", "", Some("problem"), true, 201),
        ("PATCH", ["problems", id]) => ("editProblem", *id, Some("problem"), true, 200),
        ("PUT", ["problems", id, "participation"]) => {
            ("participate", *id, Some("participation"), true, 200)
        }
        ("POST", ["problems", id, "comments"]) => ("comment", *id, Some("comment"), true, 201),
        ("POST", ["problems", id, "solutions"]) => {
            ("addSolution", *id, Some("solution"), true, 201)
        }
        ("POST", ["problems", id, "reopen"]) => ("reopen", *id, Some("reason"), true, 201),
        ("GET", ["solutions", id]) => ("getSolution", *id, None, false, 200),
        ("PATCH", ["solutions", id]) => ("editSolution", *id, Some("solution"), true, 200),
        ("PUT", ["solutions", id, "tests"]) => ("test", *id, Some("test"), true, 200),
        ("POST", ["reports"]) => ("report", "", Some("report"), true, 201),
        ("GET", ["attachments", id]) => ("image", *id, None, false, 200),
        ("DELETE", ["attachments", id]) => ("deleteImage", *id, None, true, 200),
        ("POST", ["attachments"]) => ("upload", "", None, true, 201),
        ("GET", ["moderation"]) => ("moderation", "", None, true, 200),
        ("POST", ["moderation", "solutions", id, "verify"]) => {
            ("verify", *id, Some("verify"), true, 200)
        }
        ("POST", ["moderation", "problems", id, "status"]) => {
            ("status", *id, Some("status"), true, 200)
        }
        ("POST", ["moderation", "profiles", id, "restrict"]) => {
            ("restrict", *id, Some("restrict"), true, 200)
        }
        ("GET", ["moderation", "merge-preview"]) => ("mergePreview", "", None, true, 200),
        ("POST", ["moderation", "merge"]) => ("merge", "", Some("merge"), true, 200),
        ("POST", ["moderation", "content"]) => ("hide", "", Some("hide"), true, 200),
        ("POST", ["moderation", "reports", id, "resolve"]) => {
            ("resolveReport", *id, Some("reason"), true, 200)
        }
        _ => return None,
    };
    Some(Route {
        op,
        id,
        schema,
        private,
        status,
    })
}

#[wasm_bindgen]
pub fn http_route(method: &str, path: &str, demo: bool) -> String {
    serde_json::to_string(&lookup(method, path, demo)).unwrap()
}

#[wasm_bindgen]
pub fn image_extension(bytes: &[u8], mime: &str) -> String {
    match mime {
        "image/png" if bytes.starts_with(b"\x89PNG\r\n\x1a\n") => "png",
        "image/jpeg" if bytes.starts_with(b"\xff\xd8\xff") => "jpg",
        "image/webp" if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") => "webp",
        _ => "",
    }
    .into()
}

#[wasm_bindgen]
pub fn encode_image(bytes: &[u8]) -> String {
    STANDARD.encode(bytes)
}

#[wasm_bindgen]
pub fn decode_image(data: &str) -> Result<Vec<u8>, JsError> {
    STANDARD
        .decode(data)
        .map_err(|_| JsError::new("The saved image could not be decoded."))
}
