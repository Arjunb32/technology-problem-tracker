use crate::{Failure, Request, Result, Row, State, err, execute};
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashMap};
use wasm_bindgen::prelude::*;

const COMMIT_ATTEMPTS: u32 = 6;

impl State {
    fn collections(&self) -> [(&'static str, &[Row]); 14] {
        [
            ("profiles", &self.profiles),
            ("problems", &self.problems),
            ("participation", &self.participation),
            ("solutions", &self.solutions),
            ("revisions", &self.revisions),
            ("tests", &self.tests),
            ("verifications", &self.verifications),
            ("comments", &self.comments),
            ("timeline", &self.timeline),
            ("reports", &self.reports),
            ("audit", &self.audit),
            ("notifications", &self.notifications),
            ("attachments", &self.attachments),
            ("limits", &self.limits),
        ]
    }
}

#[derive(Serialize)]
struct Changes<'a> {
    upsert: Vec<&'a Row>,
    remove: Vec<&'a str>,
}

fn diff<'a>(before: &'a State, after: &'a State) -> Result<BTreeMap<&'static str, Changes<'a>>> {
    let mut changes = BTreeMap::new();
    let row_id = |row: &'a Row| row["id"].as_str().ok_or_else(invalid_snapshot);
    for ((name, old_rows), (_, new_rows)) in
        before.collections().into_iter().zip(after.collections())
    {
        let mut previous = HashMap::with_capacity(old_rows.len());
        for row in old_rows {
            if previous.insert(row_id(row)?, row).is_some() {
                return Err(invalid_snapshot());
            }
        }
        let mut upsert = Vec::new();
        for row in new_rows {
            // serde_json::Value compares object keys independent of insertion order.
            // PostgREST returns jsonb in a different key order than Rust serializes it.
            if previous.remove(row_id(row)?) != Some(row) {
                upsert.push(row);
            }
        }
        let remove = old_rows
            .iter()
            .filter_map(|row| row["id"].as_str())
            .filter(|id| previous.contains_key(id))
            .collect::<Vec<_>>();
        if !upsert.is_empty() || !remove.is_empty() {
            changes.insert(name, Changes { upsert, remove });
        }
    }
    Ok(changes)
}

fn invalid_snapshot() -> Failure {
    err(
        500,
        "internal_error",
        "The saved state or request could not be read.",
    )
}

fn decode_snapshot(snapshot: &str) -> Result<State> {
    serde_json::from_str(snapshot).map_err(|_| invalid_snapshot())
}

fn decode_request(request: &str) -> Result<Request> {
    serde_json::from_str(request).map_err(|_| invalid_snapshot())
}

fn packet(result: Result<Value>) -> String {
    result
        .unwrap_or_else(|failure| json!({ "failure": failure }))
        .to_string()
}

fn after_write(next: Option<State>) -> Result<State> {
    next.ok_or_else(|| {
        err(
            500,
            "internal_error",
            "A read operation cannot be committed.",
        )
    })
}

fn prepare(snapshot: &str, request: &str) -> Result<Value> {
    let before = decode_snapshot(snapshot)?;
    let (value, next) = execute(before.clone(), decode_request(request)?)?;
    let after = after_write(next)?;
    Ok(json!({
        "value": value,
        "commit": { "p_expected": before.version, "p_changes": diff(&before, &after)? }
    }))
}

#[wasm_bindgen]
pub fn prepare_commit(snapshot: &str, request: &str) -> String {
    packet(prepare(snapshot, request))
}

/// A PostgREST false response means the version changed before the transaction acquired the lock.
/// Only that result can be retried. A request failure may have reached the database.
#[wasm_bindgen]
pub fn commit_decision(attempt: u32, committed: bool, error_code: Option<String>) -> String {
    packet(match error_code.as_deref() {
        Some("23505") => Err(err(409, "conflict", "That value is already in use.")),
        Some(_) => Err(err(
            503,
            "database_unavailable",
            "Your changes could not be saved. Please try again.",
        )),
        None if committed => Ok(json!("committed")),
        None if attempt < COMMIT_ATTEMPTS => Ok(json!("retry")),
        None => Err(err(
            409,
            "concurrent_update",
            "This content changed while you were editing. Reload and try again.",
        )),
    })
}

#[wasm_bindgen]
pub fn snapshot_delta(before: &str, after: &str) -> String {
    packet((|| {
        let before = decode_snapshot(before)?;
        let after = decode_snapshot(after)?;
        Ok(
            json!({ "commit": { "p_expected": before.version, "p_changes": diff(&before, &after)? } }),
        )
    })())
}

#[wasm_bindgen]
pub fn prepare_local_commit(snapshot: &str, request: &str) -> String {
    packet((|| {
        let (value, next) = execute(decode_snapshot(snapshot)?, decode_request(request)?)?;
        let mut next = after_write(next)?;
        next.version = next.version.checked_add(1).ok_or_else(invalid_snapshot)?;
        let text = serde_json::to_string(&next).map_err(|_| invalid_snapshot())?;
        Ok(json!({ "value": value, "snapshot": text }))
    })())
}

#[wasm_bindgen]
pub fn valid_snapshot(snapshot: &str) -> bool {
    decode_snapshot(snapshot).is_ok_and(|state| {
        state.version <= 9_007_199_254_740_991
            && state
                .collections()
                .into_iter()
                .all(|(_, rows)| rows.iter().all(|row| row["id"].is_string()))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed() -> State {
        decode_snapshot(include_str!("../../../apps/api/src/demo-state.json")).unwrap()
    }

    #[test]
    fn field_order_does_not_change_a_row_and_output_contains_only_actual_updates() {
        let mut old = seed();
        old.profiles = vec![
            serde_json::from_str(r#"{"id":"1","role":"member","restricted":false}"#).unwrap(),
            json!({"id": "2"}),
        ];
        let mut new = old.clone();
        new.profiles = vec![
            serde_json::from_str(r#"{"restricted":false,"role":"member","id":"1"}"#).unwrap(),
            json!({"id": "3"}),
        ];
        let value = serde_json::to_value(diff(&old, &new).unwrap()).unwrap();
        assert_eq!(
            value,
            json!({"profiles": {"upsert": [{"id": "3"}], "remove": ["2"]}})
        );
    }

    #[test]
    fn stale_versions_stop_at_six_and_uncertain_outcomes_are_not_retried() {
        assert_eq!(commit_decision(5, false, None), "\"retry\"");
        assert_eq!(commit_decision(6, true, None), "\"committed\"");
        let stale: Value = serde_json::from_str(&commit_decision(6, false, None)).unwrap();
        assert_eq!(stale["failure"]["code"], "concurrent_update");
        let conflict: Value =
            serde_json::from_str(&commit_decision(1, false, Some("23505".into()))).unwrap();
        assert_eq!(conflict["failure"]["code"], "conflict");
        let uncertain: Value =
            serde_json::from_str(&commit_decision(1, false, Some(String::new()))).unwrap();
        assert_eq!(uncertain["failure"]["code"], "database_unavailable");
    }
}
