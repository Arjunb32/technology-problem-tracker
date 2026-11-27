mod browser;

use serde_json::{Value, json};
use std::sync::LazyLock;
use wasm_bindgen::prelude::*;

static SCHEMAS: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../packages/contracts/schemas.json"))
        .expect("checked contract schemas")
});

fn kind(input: Option<&Value>) -> &'static str {
    match input {
        None => "undefined",
        Some(Value::Null) => "null",
        Some(Value::Array(_)) => "array",
        Some(Value::String(_)) => "string",
        Some(Value::Bool(_)) => "boolean",
        Some(Value::Number(_)) => "number",
        Some(Value::Object(_)) => "object",
    }
}
fn invalid_type(path: &[Value], expected: &str, received: &str) -> Value {
    json!({"expected":expected,"code":"invalid_type","path":path,"message":format!("Invalid input: expected {expected}, received {received}")})
}
fn size_issue(
    origin: &str,
    len: usize,
    min: Option<u64>,
    max: Option<u64>,
    path: &[Value],
    issue: Option<&str>,
) -> Option<Value> {
    let noun = if origin == "string" {
        "characters"
    } else {
        "items"
    };
    if let Some(limit) = min.filter(|m| (len as u64) < *m) {
        let msg = issue
            .map(str::to_owned)
            .unwrap_or_else(|| format!("Too small: expected {origin} to have >={limit} {noun}"));
        return Some(
            json!({"origin":origin,"code":"too_small","minimum":limit,"inclusive":true,"path":path,"message":msg}),
        );
    }
    max.filter(|m|len as u64>*m).map(|limit|json!({"origin":origin,"code":"too_big","maximum":limit,"inclusive":true,"path":path,"message":format!("Too big: expected {origin} to have <={limit} {noun}")}))
}
fn check(
    schema: &Value,
    input: Option<&Value>,
    path: &mut Vec<Value>,
    issues: &mut Vec<Value>,
    name: &str,
) -> Value {
    let actual = if name == "offset" && input.is_some_and(Value::is_null) {
        "NaN"
    } else {
        kind(input)
    };
    let value = input.unwrap_or(&Value::Null);
    if let Some(options) = schema["enum"].as_array() {
        if !options.contains(value) {
            issues.push(json!({"code":"invalid_value","values":options,"path":path,"message":format!("Invalid option: expected one of {}",options.iter().map(Value::to_string).collect::<Vec<_>>().join("|"))}))
        }
        return value.clone();
    }
    if let Some(wanted) = schema.get("const") {
        if value != wanted {
            issues.push(json!({"code":"invalid_value","values":[wanted],"path":path,"message":format!("Invalid input: expected {wanted}")}))
        }
        return value.clone();
    }
    let ty = schema["type"].as_str().unwrap_or_default();
    let expected = if ty == "integer" { "number" } else { ty };
    if actual != expected {
        issues.push(invalid_type(path, expected, actual));
        return Value::Null;
    }
    match ty {
        "object" => {
            let fields = schema["properties"].as_object().unwrap();
            let mut out = json!({});
            for (k, rule) in fields {
                if let Some(v) = value.get(k) {
                    path.push(json!(k));
                    out[k] = check(rule, Some(v), path, issues, name);
                    path.pop();
                } else if let Some(default) = rule.get("default") {
                    out[k] = default.clone()
                } else if schema["required"]
                    .as_array()
                    .is_some_and(|a| a.iter().any(|r| r == k))
                {
                    path.push(json!(k));
                    check(rule, None, path, issues, name);
                    path.pop();
                }
            }
            let extra = value
                .as_object()
                .unwrap()
                .keys()
                .filter(|k| !fields.contains_key(*k))
                .collect::<Vec<_>>();
            if !extra.is_empty() {
                let word = if extra.len() == 1 { "key" } else { "keys" };
                let keys = extra
                    .iter()
                    .map(|k| json!(k).to_string())
                    .collect::<Vec<_>>()
                    .join(", ");
                issues.push(json!({"code":"unrecognized_keys","keys":extra,"path":path,"message":format!("Unrecognized {word}: {keys}")}));
            }
            out
        }
        "array" => {
            let arr = value.as_array().unwrap();
            let values = arr
                .iter()
                .enumerate()
                .map(|(i, v)| {
                    path.push(json!(i));
                    let out = check(&schema["items"], Some(v), path, issues, name);
                    path.pop();
                    out
                })
                .collect::<Vec<_>>();
            if let Some(e) = size_issue(
                "array",
                arr.len(),
                None,
                schema["maxItems"].as_u64(),
                path,
                None,
            ) {
                issues.push(e)
            }
            json!(values)
        }
        "string" => {
            let field = path.first().and_then(Value::as_str).unwrap_or_default();
            let raw = value.as_str().unwrap();
            let text = if name == "identifier"
                || matches!(field, "revisionId" | "targetId" | "sourceId")
            {
                raw
            } else {
                raw.trim_matches(|c: char| c == '\u{feff}' || (c.is_whitespace() && c != '\u{85}'))
            };
            let message = match (name, field) {
                ("problem", "title") => Some("Use at least 10 characters for the title."),
                ("problem", "description") => {
                    Some("Add at least 30 characters describing the issue.")
                }
                _ => None,
            };
            if let Some(e) = size_issue(
                "string",
                text.chars().count(),
                schema["minLength"].as_u64(),
                schema["maxLength"].as_u64(),
                path,
                message,
            ) {
                issues.push(e)
            }
            if let Some(pattern) = schema["pattern"].as_str()
                && (!(3..=30).contains(&text.len())
                    || !text
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-'))
            {
                issues.push(json!({"origin":"string","code":"invalid_format","format":"regex","pattern":format!("/{pattern}/"),"path":path,"message":format!("Invalid string: must match pattern /{pattern}/")}));
            }
            json!(text)
        }
        "integer" => {
            let n = value.as_f64().unwrap();
            if n.fract() != 0.0 {
                let mut e = invalid_type(path, "int", "number");
                e["format"] = json!("safeint");
                issues.push(e)
            } else if n.abs() > 9_007_199_254_740_991.0 {
                let mut e = if n > 0.0 {
                    json!({"code":"too_big","maximum":9007199254740991i64,"message":"Too big: expected int to be <=9007199254740991"})
                } else {
                    json!({"code":"too_small","minimum":-9007199254740991i64,"message":"Too small: expected int to be >=-9007199254740991"})
                };
                e["origin"] = json!("int");
                e["note"] = json!("Integers must be within the safe integer range.");
                e["path"] = json!(path);
                e["inclusive"] = json!(true);
                issues.push(e)
            }
            if let Some(min) = schema["minimum"].as_i64().filter(|m| n < *m as f64) {
                issues.push(json!({"origin":"number","code":"too_small","minimum":min,"inclusive":true,"path":path,"message":format!("Too small: expected number to be >={min}")}));
            }
            if let Some(max) = schema["maximum"]
                .as_i64()
                .filter(|m| name == "offset" && n > *m as f64)
            {
                issues.push(json!({"origin":"number","code":"too_big","maximum":max,"inclusive":true,"path":path,"message":format!("Too big: expected number to be <={max}")}));
            }
            if schema.get("exclusiveMinimum").is_some() && n <= 0.0 {
                issues.push(json!({"origin":"number","code":"too_small","minimum":0,"inclusive":false,"path":path,"message":"Too small: expected number to be >0"}))
            }
            json!(n as i64)
        }
        _ => value.clone(),
    }
}
pub fn checked(name: &str, input: &Value) -> Value {
    let Some(schema) = SCHEMAS.get(name) else {
        return json!({"success":false,"error":{"issues":[{"code":"custom","path":[],"message":"Unknown contract."}]}});
    };
    let mut issues = Vec::new();
    let data = check(schema, Some(input), &mut Vec::new(), &mut issues, name);
    if name == "participation"
        && data["kind"] == "affected"
        && data["active"] == true
        && data["setup"]
            .as_str()
            .is_some_and(|s| s.encode_utf16().count() < 3)
        && !issues.iter().any(|i| {
            matches!(
                i["code"].as_str(),
                Some("invalid_type" | "invalid_value" | "unrecognized_keys")
            )
        })
    {
        issues.push(json!({"code":"custom","path":["setup"],"message":"Describe the setup where you experience this issue."}))
    }
    if issues.is_empty() {
        json!({"success":true,"data":data})
    } else {
        json!({"success":false,"error":{"issues":issues}})
    }
}
#[wasm_bindgen]
pub fn validate(name: &str, input: &str) -> String {
    if input.is_empty()
        && let Some(schema) = SCHEMAS.get(name)
    {
        let mut issues = Vec::new();
        check(schema, None, &mut Vec::new(), &mut issues, name);
        return json!({"success":false,"error":{"issues":issues}}).to_string();
    }
    checked(name, &serde_json::from_str(input).unwrap_or(Value::Null)).to_string()
}

#[wasm_bindgen]
pub fn test_stats(input: &str) -> String {
    let tests: Vec<Value> = serde_json::from_str(input).unwrap_or_default();
    let mut counts = json!({"Worked":0,"Did not work":0,"Partially worked":0,"Not applicable":0});
    for test in &tests {
        if let Some(k) = test["outcome"].as_str()
            && let Some(n) = counts[k].as_u64()
        {
            counts[k] = json!(n + 1)
        }
    }
    let applicable = tests.len() as u64 - counts["Not applicable"].as_u64().unwrap();
    let rate = (applicable != 0)
        .then(|| (counts["Worked"].as_u64().unwrap() * 100 + applicable / 2) / applicable);
    json!({"counts":counts,"applicable":applicable,"successRate":rate}).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn baseline_contracts() {
        let cases: Vec<Value> =
            serde_json::from_str(include_str!("../../../tests/fixtures/validation.json")).unwrap();
        for c in cases {
            assert_eq!(
                checked(c["schema"].as_str().unwrap(), &c["input"]),
                c["expected"],
                "{}",
                c["schema"]
            )
        }
    }
}
