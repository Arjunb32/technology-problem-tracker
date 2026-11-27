use serde_json::{Value, json};
use wasm_bindgen::prelude::*;

const ATTACHMENT_LIMIT: u64 = 500 * 1024;
const INPUT_IMAGE_LIMIT: u64 = 20 * 1024 * 1024;
const FEED_PAGE_SIZE: u64 = 50;
const FEED_MAX_OFFSET: u64 = 500;

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or_default()
}

fn trim(text: &str) -> &str {
    text.trim_matches(|c: char| c == '\u{feff}' || (c.is_whitespace() && c != '\u{85}'))
}

fn words(csv: &str) -> Vec<&str> {
    csv.split(',')
        .map(trim)
        .filter(|entry| !entry.is_empty())
        .collect()
}

fn form_result(name: &str, value: &Value) -> Value {
    let validated = super::checked(name, value);
    if validated["success"] == true {
        return json!({"data":validated["data"]});
    }
    let issues = validated["error"]["issues"]
        .as_array()
        .expect("validation returns issues");
    let message = issues
        .iter()
        .map(|issue| {
            let path = issue["path"]
                .as_array()
                .expect("validation issues have a path");
            let parts = path
                .iter()
                .map(|part| {
                    part.as_str()
                        .map(str::to_owned)
                        .unwrap_or_else(|| part.to_string())
                })
                .collect::<Vec<_>>();
            format!("{}: {}", parts.join(" "), text(issue, "message"))
        })
        .collect::<Vec<_>>()
        .join(" ");
    json!({"error":message})
}

fn form_submission(input: &Value) -> Value {
    let form = &input["form"];
    match text(input, "kind") {
        "problem" => {
            let mut form = form.clone();
            if let Some(draft) = form.as_object_mut() {
                draft.insert("tags".into(), json!(words(text(input, "csv"))));
                if let Some(version) = input.get("version") {
                    draft.insert("version".into(), version.clone());
                }
            }
            let result = form_result("problem", &form);
            if result["data"].is_object()
                && input.get("version").is_none()
                && form["affected"] == true
                && trim(text(&form, "setup")).encode_utf16().count() < 3
            {
                return json!({"error":"Describe the setup where you are affected, or untick the affected confirmation."});
            }
            result
        }
        "profile" => {
            let mut form = form.clone();
            if let Some(fields) = form.as_object_mut() {
                fields.insert("expertise".into(), json!(words(text(input, "csv"))));
            }
            let result = super::checked("profile", &form);
            if result["success"] == true {
                json!({"data":result["data"]})
            } else {
                let issues = result["error"]["issues"]
                    .as_array()
                    .expect("validation returns issues");
                let message = issues
                    .iter()
                    .map(|issue| text(issue, "message"))
                    .collect::<Vec<_>>()
                    .join(" ");
                json!({"error":message})
            }
        }
        _ => form_result("solution", form),
    }
}

fn component(text: &str, query: bool) -> String {
    let mut result = String::with_capacity(text.len());
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric()
            || b"-_.*".contains(&byte)
            || (!query && b"~!'()".contains(&byte))
        {
            result.push(char::from(byte));
        } else if query && byte == b' ' {
            result.push('+');
        } else {
            use std::fmt::Write;
            write!(&mut result, "%{byte:02X}").expect("writing to String");
        }
    }
    result
}

fn query(fields: &[(&str, &str)]) -> String {
    fields
        .iter()
        .map(|(key, val)| format!("{key}={}", component(val, true)))
        .collect::<Vec<_>>()
        .join("&")
}

fn feed_options(input: &Value) -> Value {
    let page = input["page"]
        .as_f64()
        .unwrap_or(1.0)
        .floor()
        .clamp(1.0, (FEED_MAX_OFFSET / FEED_PAGE_SIZE + 1) as f64) as u64;
    let offset = (page - 1) * FEED_PAGE_SIZE;
    let sort = match text(input, "sort") {
        value @ ("affected" | "unsolved" | "solved" | "new") => value,
        _ => "trending",
    };
    let category = match text(input, "category") {
        value @ ("Computers" | "Software" | "Networking") => value,
        _ => "",
    };
    let query_text = text(input, "q");
    let offset_string = offset.to_string();
    let mut filters = vec![("sort", sort), ("offset", &offset_string)];
    if !category.is_empty() {
        filters.push(("category", category));
    }
    if !query_text.is_empty() {
        filters.push(("q", query_text));
    }
    json!({"sort":sort,"category":category,"query":query_text,"page":page,"offset":offset,"path":format!("/problems?{}",query(&filters))})
}

fn request(method: &str, path: String, body: Value) -> Value {
    json!({"method":method,"path":path,"body":body})
}

fn request_plan(input: &Value) -> Value {
    let id = component(text(input, "id"), false);
    let data = &input["data"];
    match text(input, "kind") {
        "config" => request("GET", "/config".into(), Value::Null),
        "me" => request("GET", "/me".into(), Value::Null),
        "demo" => request("POST", "/auth/demo".into(), json!({"userId":data})),
        "following" => request("GET", "/me/following".into(), Value::Null),
        "notifications" => request("GET", "/me/notifications".into(), Value::Null),
        "markNotification" => request(
            "PATCH",
            format!("/me/notifications/{id}"),
            json!({"read":true}),
        ),
        "profile" => request("GET", format!("/profiles/{id}"), Value::Null),
        "saveProfile" => request("PATCH", "/me".into(), data.clone()),
        "detail" => request("GET", format!("/problems/{id}"), Value::Null),
        "solution" => request("GET", format!("/solutions/{id}"), Value::Null),
        "saveProblem" if id.is_empty() => request("POST", "/problems".into(), data.clone()),
        "saveProblem" => request("PATCH", format!("/problems/{id}"), data.clone()),
        "addSolution" => request("POST", format!("/problems/{id}/solutions"), data.clone()),
        "reviseSolution" => request("PATCH", format!("/solutions/{id}"), data.clone()),
        "participate" => request("PUT", format!("/problems/{id}/participation"), data.clone()),
        "test" => request("PUT", format!("/solutions/{id}/tests"), data.clone()),
        "comment" => request("POST", format!("/problems/{id}/comments"), data.clone()),
        "reopen" => request("POST", format!("/problems/{id}/reopen"), data.clone()),
        "report" => request("POST", "/reports".into(), data.clone()),
        "deleteImage" => request("DELETE", format!("/attachments/{id}"), Value::Null),
        "readImage" => request("GET", format!("/attachments/{id}"), Value::Null),
        "moderation" => request("GET", "/moderation".into(), Value::Null),
        "mergePreview" => request(
            "GET",
            format!(
                "/moderation/merge-preview?{}",
                query(&[
                    ("sourceId", text(data, "sourceId")),
                    ("targetId", text(data, "targetId"))
                ])
            ),
            Value::Null,
        ),
        "merge" => request("POST", "/moderation/merge".into(), data.clone()),
        "moderate" => {
            let action = &data["action"];
            let reason = &data["reason"];
            let (path, body) = match text(action, "kind") {
                "verify" => (
                    format!(
                        "/moderation/solutions/{}/verify",
                        component(text(&action["solution"], "id"), false)
                    ),
                    json!({"revisionId":action["solution"]["currentRevision"]["id"],"evidence":data["evidence"],"supportedScope":data["scope"],"reason":reason,"decision":data["decision"]}),
                ),
                "status" => (
                    format!(
                        "/moderation/problems/{}/status",
                        component(text(&action["problem"], "id"), false)
                    ),
                    json!({"status":data["status"],"reason":reason}),
                ),
                "restrict" => (
                    format!(
                        "/moderation/profiles/{}/restrict",
                        component(text(&action["profile"], "id"), false)
                    ),
                    json!({"restricted":action["profile"]["restricted"]!=true,"reason":reason}),
                ),
                "resolve" => (
                    format!(
                        "/moderation/reports/{}/resolve",
                        component(text(&action["report"], "id"), false)
                    ),
                    json!({"reason":reason}),
                ),
                "content" => (
                    "/moderation/content".into(),
                    json!({"targetType":action["targetType"],"targetId":action["targetId"],"hidden":action["hidden"],"reason":reason}),
                ),
                _ => return Value::Null,
            };
            request("POST", path, body)
        }
        _ => Value::Null,
    }
}

fn session_role(profile: &Value) -> &'static str {
    if profile.is_null() {
        "guest"
    } else if profile["restricted"] == true {
        "restricted"
    } else if matches!(text(profile, "role"), "moderator" | "admin") {
        "moderator"
    } else {
        "member"
    }
}

fn retry_public(input: &Value) -> bool {
    let resource = text(input, "path")
        .strip_prefix('/')
        .unwrap_or_default()
        .split(['/', '?'])
        .next()
        .unwrap_or_default();
    input["status"] == 401
        && input["hadToken"] == true
        && text(input, "method") == "GET"
        && matches!(resource, "config" | "problems" | "profiles" | "solutions")
}

fn image_options(input: &Value) -> Value {
    if !matches!(
        text(input, "mime"),
        "image/jpeg" | "image/png" | "image/webp"
    ) {
        return json!({"error":"Choose a JPEG, PNG, or WebP image."});
    }
    if input["size"].as_u64().unwrap_or_default() > INPUT_IMAGE_LIMIT {
        return json!({"error":"Choose an image smaller than 20 MB before compression."});
    }
    let width = input["width"].as_u64().unwrap_or(1) as f64;
    let height = input["height"].as_u64().unwrap_or(1) as f64;
    let scale = (1800.0 / width.max(height)).min(1.0);
    let name = text(input, "name");
    let stem = name
        .rsplit_once('.')
        .filter(|(_, extension)| !extension.is_empty())
        .map(|(base, _)| base)
        .unwrap_or(name);
    json!({"data":{"width":(width*scale).round().max(1.0) as u64,"height":(height*scale).round().max(1.0) as u64,"name":format!("{stem}.webp"),"mime":"image/webp","limit":ATTACHMENT_LIMIT,"qualities":[0.9,0.78,0.65,0.5,0.35]}})
}

fn modal_key(input: &Value) -> &'static str {
    match text(input, "key") {
        "Escape" => "close",
        "Tab" if input["count"] == 0 => "dialog",
        "Tab"
            if input["reverse"] == true && (input["index"] == 0 || input["contains"] == false) =>
        {
            "last"
        }
        "Tab"
            if input["reverse"] == false
                && (input["index"].as_i64() == input["count"].as_i64().map(|n| n - 1)
                    || input["contains"] == false) =>
        {
            "first"
        }
        _ => "default",
    }
}

fn draft(input: &Value) -> Value {
    let mut value = input["defaults"].clone();
    if let Some(fields) = value.as_object_mut()
        && let Some(saved) = input["saved"].as_str()
        && let Ok(Value::Object(overrides)) = serde_json::from_str(saved)
    {
        for (key, saved_field) in overrides {
            if fields.get(&key).is_some_and(|original| {
                std::mem::discriminant(original) == std::mem::discriminant(&saved_field)
            }) {
                fields.insert(key, saved_field);
            }
        }
    }
    value
}

fn run(operation: &str, input: &Value) -> Value {
    match operation {
        "feed" => feed_options(input),
        "request" => request_plan(input),
        "form" => form_submission(input),
        "csv" => json!(words(input.as_str().unwrap_or_default())),
        "suggestion" => {
            let title = text(input, "title");
            if input["editing"] == true || trim(title).encode_utf16().count() < 6 {
                Value::Null
            } else {
                json!(format!(
                    "/problems?q={}&sort=trending",
                    component(title, false)
                ))
            }
        }
        "oauth" => {
            let mut settings =
                json!({"redirectTo":format!("{}/auth/callback",text(input,"origin"))});
            if input["provider"] == "azure" {
                settings["scopes"] = json!("email");
            }
            settings
        }
        "routes" => json!([
            ["/", "feed"],
            ["/problems/:id", "problem"],
            ["/report", "report"],
            ["/problems/:id/edit", "report"],
            ["/problems/:id/solutions/new", "solution"],
            ["/solutions/:solutionId/edit", "solution"],
            ["/profiles/:id", "profile"],
            ["/following", "following"],
            ["/notifications", "notifications"],
            ["/settings", "settings"],
            ["/moderation", "moderation"],
            ["/auth/callback", "auth"],
            ["/rules", "rules"],
            ["/privacy", "privacy"]
        ]),
        "role" => json!(session_role(input)),
        "retryPublic" => json!(retry_public(input)),
        "image" => image_options(input),
        "modal" => json!(modal_key(input)),
        "draft" => draft(input),
        _ => Value::Null,
    }
}

#[wasm_bindgen]
pub fn browser_policy(operation: &str, input: &str) -> String {
    let input = serde_json::from_str(input).unwrap_or(Value::Null);
    run(operation, &input).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn feed_sanitizes_invalid_filters_and_encodes_public_queries() {
        let result = feed_options(
            &json!({"page":100,"category":"Unknown","sort":"bad","q":"Wi-Fi + 5 GHz"}),
        );
        assert_eq!(
            result["path"],
            "/problems?sort=trending&offset=500&q=Wi-Fi+%2B+5+GHz"
        );
        assert_eq!(result["page"], 11);
    }
    #[test]
    fn retry_only_permits_authenticated_public_gets() {
        let mut input = json!({"path":"/problems/p","method":"GET","status":401,"hadToken":true});
        assert!(retry_public(&input));
        input["method"] = json!("POST");
        assert!(!retry_public(&input));
        input["method"] = json!("GET");
        input["path"] = json!("/problems-secret");
        assert!(!retry_public(&input));
    }
    #[test]
    fn corrupt_draft_fields_preserve_defaults() {
        assert_eq!(
            draft(
                &json!({"defaults":{"title":"","tags":[]},"saved":"{\"title\":\"Unsent\",\"tags\":99,\"foo\":true}"})
            ),
            json!({"title":"Unsent","tags":[]})
        );
    }
    #[test]
    fn image_rules_keep_aspect_ratio_and_attachment_limit() {
        let output = image_options(
            &json!({"mime":"image/jpeg","size":1024,"width":2400,"height":1200,"name":"test.photo.jpeg"}),
        );
        assert_eq!(output["data"]["width"], 1800);
        assert_eq!(output["data"]["height"], 900);
        assert_eq!(output["data"]["name"], "test.photo.webp");
        assert_eq!(output["data"]["limit"], 500 * 1024);
        assert!(image_options(&json!({"mime":"text/plain","size":1}))["error"].is_string());
    }
    #[test]
    fn moderation_targets_current_revision_and_preserves_reason() {
        let plan = request_plan(
            &json!({"kind":"moderate","data":{"action":{"kind":"verify","solution":{"id":"a/b","currentRevision":{"id":"r2"}}},"decision":"verified","reason":"A concrete reason","scope":"A setup","evidence":"Recorded evidence"}}),
        );
        assert_eq!(plan["path"], "/moderation/solutions/a%2Fb/verify");
        assert_eq!(plan["body"]["revisionId"], "r2");
        assert_eq!(plan["body"]["reason"], "A concrete reason");
    }
}
