use super::*;

impl Engine {
    fn create_problem(&mut self, d: &Row) -> Result<Row> {
        if d.flag("affected") && d.text("setup").encode_utf16().count() < 3 {
            return Err(err(
                422,
                "validation_error",
                "Describe the setup where you experience this problem.",
            ));
        }
        if !self.demo && self.state.problems.len() >= 500 {
            return Err(err(
                503,
                "beta_capacity",
                "The beta has reached its reporting capacity. Existing problems can still be investigated.",
            ));
        }
        let id = self.id();
        let mut p = d.clone();
        let fields = p.as_object_mut().unwrap();
        fields.remove("affected");
        fields.remove("version");
        p.extend(&json!({"id":id,"authorId":self.actor,"status":"Reported","canonicalId":null,"hidden":false,"demo":self.demo,"createdAt":self.now,"updatedAt":self.now,"resolvedAt":null,"version":1}));
        self.state.problems.push(p.clone());
        if d.flag("affected") {
            self.add_part(&id, "affected", d.text("setup"))
        }
        self.add_part(&id, "follow", "");
        self.actor_event(&id, "reported", "Problem reported.", None, Some("Reported"));
        self.present(&p)
    }
    fn edit_problem(&mut self, id: &str, d: &Row) -> Result<Row> {
        let p = self.problem(id, false)?;
        if p["authorId"] != self.actor {
            return Err(err(
                403,
                "forbidden",
                "Only the author can edit this report.",
            ));
        }
        if d["version"] != p["version"] {
            return Err(err(
                409,
                "concurrent_update",
                "This report changed. Reload it before saving.",
            ));
        }
        let material = ["setup", "product", "description", "classification"]
            .iter()
            .any(|k| p[k] != d[k]);
        let status = p.text("status").to_owned();
        let mut fields = d.clone();
        fields.as_object_mut().unwrap().remove("affected");
        fields.as_object_mut().unwrap().remove("version");
        if material && matches!(status.as_str(), "Resolved" | "Partially solved") {
            fields["status"] = json!("Reopened");
            fields["resolvedAt"] = Value::Null;
            self.actor_event(id,"scope_changed","The author changed the reported scope. Existing solution evidence remains available.",Some(&status),Some("Reopened"));
        }
        self.update_problem(id, &fields)?;
        self.actor_event(id, "edited", "The author updated the report.", None, None);
        self.present(self.problem(id, false)?)
    }
    fn add_part(&mut self, id: &str, kind: &str, setup: &str) {
        let row = json!({"id":self.id(),"problemId":id,"userId":self.actor,"kind":kind,"setup":setup,"createdAt":self.now});
        self.state.participation.push(row);
    }
    fn participate(&mut self, id: &str, d: &Row) -> Result<Row> {
        let status = self.problem(id, false)?.text("status").to_owned();
        let matches =
            |r: &Row| r["problemId"] == id && r["userId"] == self.actor && r["kind"] == d["kind"];
        if d.flag("active") {
            if let Some(row) = self.state.participation.iter_mut().find(|r| matches(r)) {
                row["setup"] = d["setup"].clone()
            } else {
                self.add_part(id, d.text("kind"), d.text("setup"))
            }
        } else {
            self.state.participation.retain(|r| !matches(r))
        }
        let count = self
            .state
            .participation
            .iter()
            .filter(|r| r["problemId"] == id && r["kind"] == "affected")
            .count();
        if count >= 2 && matches!(status.as_str(), "Reported" | "Needs information") {
            self.update_problem(id, &json!({"status":"Confirmed"}))?;
            self.event(
                id,
                None,
                "community_confirmed",
                "Two distinct accounts confirmed an affected setup.",
                Some(&status),
                Some("Confirmed"),
            );
            self.notify(
                id,
                "Problem confirmed",
                "Two members now report this issue.",
            )?;
        } else if count < 2 && status == "Confirmed" {
            self.update_problem(id, &json!({"status":"Needs information"}))?;
            self.event(
                id,
                None,
                "confirmation_withdrawn",
                "Fewer than two affected confirmations remain.",
                Some("Confirmed"),
                Some("Needs information"),
            );
        }
        self.present(self.problem(id, false)?)
    }
    fn solution_revision(&mut self, id: &str, d: &Row, edit: bool) -> Result<Row> {
        let (sid, pid, num) = if edit {
            let sol = self.sol(id)?;
            let pid = sol.text("problemId").to_owned();
            self.problem(&pid, false)?;
            if sol["authorId"] != self.actor {
                return Err(err(
                    403,
                    "forbidden",
                    "Only the author can revise this solution.",
                ));
            }
            if sol.flag("hidden") {
                return Err(err(409, "hidden", "Hidden solutions cannot be edited."));
            }
            let current = self.latest(id)?;
            if d.as_object()
                .unwrap()
                .iter()
                .all(|(k, v)| current.get(k) == Some(v))
            {
                return self.solution(sol);
            }
            let num = current.num("number") + 1;
            self.state
                .solutions
                .iter_mut()
                .find(|s| s["id"] == id)
                .unwrap()["updatedAt"] = json!(self.now);
            (id.to_owned(), pid, num)
        } else {
            self.problem(id, false)?;
            let sid = self.id();
            self.state.solutions.push(json!({"id":sid,"problemId":id,"authorId":self.actor,"hidden":false,"demo":self.demo,"createdAt":self.now,"updatedAt":self.now}));
            (sid, id.to_owned(), 1)
        };
        let mut rev = d.clone();
        rev.extend(&json!({"id":self.id(),"solutionId":sid,"number":num,"createdAt":self.now}));
        self.state.revisions.push(rev);
        if edit {
            self.reopen_unverified(&pid,"verification_invalidated","The verified solution was materially revised. Previous test evidence is preserved.")?;
            self.actor_event(
                &pid,
                "solution_revised",
                &format!("Solution revision {num} requires fresh verification."),
                None,
                None,
            );
            self.notify(
                &pid,
                "Solution revised",
                "A new solution revision is ready for testing.",
            )?;
        } else {
            self.actor_event(&pid, "solution_proposed", d.text("title"), None, None);
            self.notify(&pid, "A fix was proposed", d.text("title"))?;
        }
        self.solution(self.sol(&sid)?)
    }
    fn record_test(&mut self, id: &str, d: &Row) -> Result<Row> {
        let sol = self.sol(id)?;
        if sol.flag("hidden") {
            return Err(missing("Solution not found."));
        }
        self.problem(sol.text("problemId"), false)?;
        if !self
            .state
            .revisions
            .iter()
            .any(|r| r["id"] == d["revisionId"] && r["solutionId"] == id)
        {
            return Err(err(
                422,
                "invalid_revision",
                "Choose a revision belonging to this solution.",
            ));
        }
        if let Some(r) = self
            .state
            .tests
            .iter_mut()
            .find(|t| t["userId"] == self.actor && t["revisionId"] == d["revisionId"])
        {
            r.extend(d);
            r["updatedAt"] = json!(self.now);
        } else {
            let mut row = d.clone();
            row.extend(&json!({"id":self.id(),"userId":self.actor,"createdAt":self.now,"updatedAt":self.now}));
            self.state.tests.push(row);
        }
        self.solution(self.sol(id)?)
    }
    pub(super) fn authorize_upload(&self, d: &Row) -> Result<()> {
        if self.profile(&self.actor)?.flag("restricted") {
            return Err(err(403, "restricted", "Your account is restricted."));
        }
        let ty = d.text("targetType");
        let id = d.text("targetId");
        let t = self.target(ty, id)?;
        if t["authorId"] != self.actor || t.flag("hidden") {
            return Err(err(
                403,
                "forbidden",
                "Only the content author can attach images.",
            ));
        }
        self.problem(
            if ty == "problem" {
                id
            } else {
                t.text("problemId")
            },
            false,
        )?;
        if self
            .state
            .attachments
            .iter()
            .filter(|a| a["targetType"] == ty && a["targetId"] == id && a["ownerId"] == self.actor)
            .count()
            >= 3
        {
            return Err(err(
                422,
                "attachment_limit",
                "Use at most three images per contribution.",
            ));
        }
        Ok(())
    }
    pub(super) fn contribute(&mut self, op: &str, id: &str, d: &Row) -> Result<Option<Row>> {
        Ok(Some(match op {
            "ensureProfile" => {
                if let Ok(p) = self.profile(&self.actor) {
                    return Ok(Some(p.clone()));
                }
                let name = d
                    .text("displayName")
                    .trim()
                    .chars()
                    .take(80)
                    .collect::<String>();
                let username = format!(
                    "member_{}",
                    self.actor
                        .replace('-', "")
                        .chars()
                        .take(12)
                        .collect::<String>()
                );
                let mut p = json!({"id":self.actor,"username":username,"displayName":if name.encode_utf16().count()>=2{&name}else{"Community member"},"bio":"","expertise":[],"role":"member","restricted":false,"createdAt":self.now});
                if d.text("avatarUrl").starts_with("https://") {
                    p["avatarUrl"] = d["avatarUrl"].clone()
                }
                self.state.profiles.push(p.clone());
                p
            }
            "updateProfile" => {
                if self.state.profiles.iter().any(|p| {
                    p["id"] != self.actor
                        && p.text("username").eq_ignore_ascii_case(d.text("username"))
                }) {
                    return Err(err(409, "conflict", "That username is already in use."));
                }
                let p = self
                    .state
                    .profiles
                    .iter_mut()
                    .find(|p| p["id"] == self.actor)
                    .unwrap();
                p.extend(d);
                p.clone()
            }
            "createProblem" => self.create_problem(d)?,
            "editProblem" => self.edit_problem(id, d)?,
            "participate" => self.participate(id, d)?,
            "comment" => {
                self.problem(id, false)?;
                let row = json!({"id":self.id(),"problemId":id,"authorId":self.actor,"body":d["body"],"hidden":false,"createdAt":self.now});
                self.state.comments.push(row.clone());
                self.notify(
                    id,
                    "New discussion",
                    &d.text("body").chars().take(160).collect::<String>(),
                )?;
                self.comment_view(&row)?
            }
            "addSolution" | "editSolution" => {
                self.solution_revision(id, d, op == "editSolution")?
            }
            "test" => self.record_test(id, d)?,
            "markNotification" => {
                let r = self
                    .state
                    .notifications
                    .iter_mut()
                    .find(|r| r["id"] == id && r["userId"] == self.actor)
                    .ok_or(missing("Notification not found."))?;
                r["read"] = json!(true);
                r.clone()
            }
            "report" | "reopen" => {
                let reopen = op == "reopen";
                let (target, kind, reason, details) = if reopen {
                    let p = self.problem(id, false)?;
                    if !matches!(p.text("status"), "Resolved" | "Closed" | "Partially solved") {
                        return Err(err(409, "invalid_status", "This problem is already open."));
                    }
                    (id, "problem", "Reopen request", d.text("reason"))
                } else {
                    self.target(d.text("targetType"), d.text("targetId"))?;
                    (
                        d.text("targetId"),
                        d.text("targetType"),
                        d.text("reason"),
                        d.text("details"),
                    )
                };
                if let Some(r) = self.state.reports.iter().find(|r| {
                    r["reporterId"] == self.actor
                        && r["targetId"] == target
                        && r["targetType"] == kind
                        && r["state"] == "open"
                        && (!reopen || r["reason"] == reason)
                }) {
                    return Ok(Some(r.clone()));
                }
                let row = json!({"id":self.id(),"reporterId":self.actor,"targetType":kind,"targetId":target,"reason":reason,"details":details,"state":"open","createdAt":self.now});
                self.state.reports.push(row.clone());
                if reopen {
                    self.actor_event(id, "reopen_requested", details, None, None)
                }
                row
            }
            "upload" => {
                self.authorize_upload(d)?;
                self.state.attachments.push(d.clone());
                self.attachment_view(d)
            }
            "deleteImage" => {
                if self
                    .state
                    .attachments
                    .iter()
                    .any(|a| a["id"] == id && a["ownerId"] != self.actor)
                {
                    return Err(err(
                        403,
                        "forbidden",
                        "Only the uploader can delete this image.",
                    ));
                }
                self.state.attachments.retain(|a| a["id"] != id);
                json!({"ok":true})
            }
            _ => return Ok(None),
        }))
    }
}
