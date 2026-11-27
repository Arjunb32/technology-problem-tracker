mod contribution;
mod moderation;
pub mod routes;
pub mod storage;
mod views;

use chrono::{DateTime, FixedOffset};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;
use wasm_bindgen::prelude::*;

type Row = Value;
type Result<T> = std::result::Result<T, Failure>;

#[derive(Debug, Serialize)]
pub struct Failure {
    pub status: u16,
    pub code: &'static str,
    pub message: &'static str,
}
fn err(status: u16, code: &'static str, message: &'static str) -> Failure {
    Failure {
        status,
        code,
        message,
    }
}
fn missing(message: &'static str) -> Failure {
    err(404, "not_found", message)
}
trait Fields {
    fn text(&self, key: &str) -> &str;
    fn num(&self, key: &str) -> i64;
    fn flag(&self, key: &str) -> bool;
    fn extend(&mut self, fields: &Value);
}
impl Fields for Value {
    fn text(&self, key: &str) -> &str {
        self[key].as_str().unwrap_or_default()
    }
    fn num(&self, key: &str) -> i64 {
        self[key].as_i64().unwrap_or_default()
    }
    fn flag(&self, key: &str) -> bool {
        self[key] == true
    }
    fn extend(&mut self, fields: &Value) {
        if let (Some(target), Some(src)) = (self.as_object_mut(), fields.as_object()) {
            target.extend(src.clone())
        }
    }
}

#[derive(Clone, Deserialize, Serialize)]
pub struct State {
    pub version: u64,
    profiles: Vec<Row>,
    problems: Vec<Row>,
    participation: Vec<Row>,
    solutions: Vec<Row>,
    revisions: Vec<Row>,
    tests: Vec<Row>,
    verifications: Vec<Row>,
    comments: Vec<Row>,
    timeline: Vec<Row>,
    reports: Vec<Row>,
    audit: Vec<Row>,
    notifications: Vec<Row>,
    attachments: Vec<Row>,
    limits: Vec<Row>,
    #[serde(flatten)]
    extra: serde_json::Map<String, Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub op: String,
    #[serde(default)]
    pub actor: String,
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub data: Value,
    pub now: String,
    pub seed: String,
    pub public_url: String,
    pub demo: bool,
}

struct Engine {
    state: State,
    actor: String,
    now: String,
    ms: i64,
    seed: Uuid,
    sequence: u64,
    public_url: String,
    demo: bool,
}
impl Engine {
    fn id(&mut self) -> String {
        self.sequence += 1;
        let bytes = Uuid::new_v5(&self.seed, &self.sequence.to_be_bytes()).into_bytes();
        // Derive independent identifier bytes from the host's random request namespace.
        uuid::Builder::from_random_bytes(bytes)
            .into_uuid()
            .to_string()
    }
    fn profile(&self, id: &str) -> Result<&Row> {
        self.state
            .profiles
            .iter()
            .find(|p| p["id"] == id)
            .ok_or(err(401, "unauthorized", "Please sign in again."))
    }
    fn is_mod(&self) -> bool {
        self.profile(&self.actor)
            .is_ok_and(|p| !p.flag("restricted") && matches!(p.text("role"), "admin" | "moderator"))
    }
    fn moderator(&self) -> Result<()> {
        self.profile(&self.actor)?;
        if self.is_mod() {
            Ok(())
        } else {
            Err(err(
                403,
                "forbidden",
                "Only moderators can perform this action.",
            ))
        }
    }
    fn problem(&self, id: &str, duplicate: bool) -> Result<&Row> {
        let p = self
            .state
            .problems
            .iter()
            .find(|p| p["id"] == id && (!p.flag("hidden") || self.is_mod()))
            .ok_or(missing("Problem not found."))?;
        if !duplicate && !p["canonicalId"].is_null() {
            return Err(err(
                409,
                "duplicate",
                "This problem has been merged. Open the canonical problem.",
            ));
        }
        Ok(p)
    }
    fn sol(&self, id: &str) -> Result<&Row> {
        self.state
            .solutions
            .iter()
            .find(|s| s["id"] == id)
            .ok_or(missing("Solution not found."))
    }
    fn capacity(&self) -> Result<()> {
        if !self.demo {
            let s = &self.state;
            let count = s.profiles.len()
                + s.problems.len()
                + s.participation.len()
                + s.solutions.len()
                + s.revisions.len()
                + s.tests.len()
                + s.verifications.len()
                + s.comments.len()
                + s.timeline.len()
                + s.reports.len()
                + s.audit.len()
                + s.notifications.len()
                + s.attachments.len()
                + s.limits.len();
            if count > 2500
                || serde_json::to_string(s)
                    .expect("JSON rows")
                    .encode_utf16()
                    .count()
                    > 750000
            {
                return Err(err(
                    503,
                    "beta_capacity",
                    "The beta has reached its safe capacity. Contact the platform owner.",
                ));
            }
        }
        Ok(())
    }
    fn begin_write(&mut self) -> Result<()> {
        if self.profile(&self.actor)?.flag("restricted") {
            return Err(err(
                403,
                "restricted",
                "Your account is restricted. Contact a moderator.",
            ));
        }
        let window = self.ms / 60000;
        self.state.limits.retain(|r| r.num("window") >= window - 1);
        if let Some(limit) = self
            .state
            .limits
            .iter_mut()
            .find(|r| r["userId"] == self.actor && r.num("window") == window)
        {
            if limit.num("count") >= 40 {
                return Err(err(
                    429,
                    "rate_limited",
                    "Too many changes. Wait a minute and try again.",
                ));
            }
            limit["count"] = json!(limit.num("count") + 1);
        } else {
            self.state.limits.push(json!({"id":format!("{}-{}",self.actor,window),"userId":self.actor,"window":window,"count":1}));
        }
        Ok(())
    }
    fn event(
        &mut self,
        pid: &str,
        actor: Option<&str>,
        kind: &str,
        reason: &str,
        from: Option<&str>,
        to: Option<&str>,
    ) {
        let row = json!({"id":self.id(),"problemId":pid,"actorId":actor,"kind":kind,"reason":reason,"fromStatus":from,"toStatus":to,"createdAt":self.now});
        self.state.timeline.push(row);
    }
    fn actor_event(
        &mut self,
        pid: &str,
        kind: &str,
        reason: &str,
        from: Option<&str>,
        to: Option<&str>,
    ) {
        self.event(pid, Some(&self.actor.clone()), kind, reason, from, to);
    }
    fn notify(&mut self, pid: &str, title: &str, body: &str) -> Result<()> {
        let mut recipients = vec![self.problem(pid, true)?.text("authorId").to_owned()];
        for row in self
            .state
            .participation
            .iter()
            .filter(|r| r["problemId"] == pid && r["kind"] == "follow")
        {
            let user = row.text("userId");
            if !recipients.iter().any(|v| v == user) {
                recipients.push(user.to_owned())
            }
        }
        for user in recipients {
            if user != self.actor {
                let row = json!({"id":self.id(),"userId":user,"problemId":pid,"title":title,"body":body,"read":false,"createdAt":self.now});
                self.state.notifications.push(row);
            }
        }
        Ok(())
    }
    fn audit(&mut self, action: &str, id: &str, reason: &str) {
        let row = json!({"id":self.id(),"actorId":self.actor,"action":action,"targetId":id,"reason":reason,"createdAt":self.now});
        self.state.audit.push(row);
    }
    fn target(&self, kind: &str, id: &str) -> Result<&Row> {
        let rows = match kind {
            "problem" => &self.state.problems,
            "solution" => &self.state.solutions,
            "comment" => &self.state.comments,
            "profile" => &self.state.profiles,
            _ => return Err(missing("Content not found.")),
        };
        rows.iter()
            .find(|r| r["id"] == id)
            .ok_or(missing("Content not found."))
    }
    fn update_problem(&mut self, id: &str, fields: &Row) -> Result<()> {
        let p = self
            .state
            .problems
            .iter_mut()
            .find(|p| p["id"] == id)
            .ok_or(missing("Problem not found."))?;
        p.extend(fields);
        p["version"] = json!(p.num("version") + 1);
        p["updatedAt"] = json!(self.now);
        Ok(())
    }
    fn reopen_unverified(&mut self, id: &str, kind: &str, reason: &str) -> Result<()> {
        let p = self.problem(id, false)?;
        if matches!(p.text("status"), "Resolved" | "Partially solved")
            && self.verified_count(id) == 0
        {
            let from = p.text("status").to_owned();
            self.update_problem(id, &json!({"status":"Reopened","resolvedAt":null}))?;
            self.actor_event(id, kind, reason, Some(&from), Some("Reopened"));
        }
        Ok(())
    }
}
fn timestamp(s: &str) -> i64 {
    DateTime::<FixedOffset>::parse_from_rfc3339(s)
        .map(|d| d.timestamp_millis())
        .unwrap_or(i64::MIN)
}

pub fn execute(state: State, req: Request) -> Result<(Value, Option<State>)> {
    let mut e = Engine {
        state,
        actor: req.actor,
        ms: timestamp(&req.now),
        now: req.now,
        seed: Uuid::parse_str(&req.seed)
            .map_err(|_| err(500, "internal_error", "Invalid request identifier."))?,
        sequence: 0,
        public_url: req.public_url,
        demo: req.demo,
    };
    let op = req.op.as_str();
    if let Some(value) = e.read(op, &req.id, &req.data)? {
        return Ok((value, None));
    }
    if op != "ensureProfile" {
        e.begin_write()?
    }
    let value = match e.contribute(op, &req.id, &req.data)? {
        Some(v) => v,
        None => e.moderate(op, &req.id, &req.data)?,
    };
    e.capacity()?;
    Ok((value, Some(e.state)))
}

#[wasm_bindgen]
pub fn dispatch(state: &str, request: &str) -> String {
    let decode = || {
        err(
            500,
            "internal_error",
            "The saved state or request could not be read.",
        )
    };
    let result = serde_json::from_str(state)
        .map_err(|_| decode())
        .and_then(|state| execute(state, serde_json::from_str(request).map_err(|_| decode())?));
    match result {
        Ok((v, Some(state))) => json!({"value":v,"state":state}),
        Ok((v, None)) => json!({"value":v}),
        Err(e) => json!({"failure":e}),
    }
    .to_string()
}

/// Serialize read responses once so the host can forward them as JSON.
#[wasm_bindgen]
pub fn dispatch_read(state: &str, request: &str) -> std::result::Result<String, JsError> {
    fn query(state: &str, request: &str) -> Result<Value> {
        let decode = || {
            err(
                500,
                "internal_error",
                "The saved state or request could not be read.",
            )
        };
        let req = serde_json::from_str(request).map_err(|_| decode())?;
        let (value, changed) = execute(serde_json::from_str(state).map_err(|_| decode())?, req)?;
        if changed.is_some() {
            return Err(err(
                500,
                "internal_error",
                "This operation requires a write transaction.",
            ));
        }
        Ok(value)
    }
    query(state, request)
        .map(|value| value.to_string())
        .map_err(|e| JsError::new(&serde_json::to_string(&e).expect("serializable error")))
}
