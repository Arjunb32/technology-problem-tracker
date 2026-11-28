use super::*;
use std::collections::HashSet;
impl Engine {
    pub(super) fn preview(&self, src: &str, dst: &str) -> Result<Row> {
        self.moderator()?;
        if src == dst {
            return Err(err(422, "invalid_merge", "Choose two different problems."));
        }
        let mut result = json!({"source":self.present(self.problem(src,false)?)?,"target":self.present(self.problem(dst,false)?)?});
        for (kind, label) in [
            ("affected", "affected"),
            ("vote", "votes"),
            ("follow", "followers"),
        ] {
            let rows =
                self.state.participation.iter().filter(|p| {
                    p["kind"] == kind && (p["problemId"] == src || p["problemId"] == dst)
                });
            result[format!("{label}Before")] = json!(rows.clone().count());
            result[format!("{label}After")] =
                json!(rows.map(|r| r.text("userId")).collect::<HashSet<_>>().len());
        }
        Ok(result)
    }
    fn merge(&mut self, d: &Row) -> Result<Row> {
        let src = d.text("sourceId");
        let dst = d.text("targetId");
        let reason = d.text("reason");
        let mut result = self.preview(src, dst)?;
        let title = result["source"].text("title");
        let parts = self
            .state
            .participation
            .iter()
            .filter(|r| r["problemId"] == src)
            .cloned()
            .collect::<Vec<_>>();
        for row in parts {
            if let Some(other) = self.state.participation.iter_mut().find(|r| {
                r["problemId"] == dst && r["userId"] == row["userId"] && r["kind"] == row["kind"]
            }) {
                if timestamp(row.text("createdAt")) < timestamp(other.text("createdAt")) {
                    other["createdAt"] = row["createdAt"].clone()
                }
                if !row.text("setup").is_empty() {
                    if other.text("setup").is_empty() {
                        other["setup"] = row["setup"].clone()
                    } else if row["kind"] == "affected" && row["setup"] != other["setup"] {
                        self.event(
                            dst,
                            Some(row.text("userId")),
                            "merged_affected_setup",
                            &format!(
                                "Additional affected setup preserved from {title}: {}",
                                row.text("setup")
                            ),
                            None,
                            None,
                        );
                    }
                }
                self.state.participation.retain(|r| r["id"] != row["id"]);
            } else {
                self.state
                    .participation
                    .iter_mut()
                    .find(|r| r["id"] == row["id"])
                    .unwrap()["problemId"] = json!(dst);
            }
        }
        for rows in [
            &mut self.state.solutions,
            &mut self.state.comments,
            &mut self.state.notifications,
        ] {
            for r in rows.iter_mut().filter(|r| r["problemId"] == src) {
                r["problemId"] = json!(dst)
            }
        }
        for r in self
            .state
            .timeline
            .iter_mut()
            .filter(|r| r["problemId"] == src)
        {
            r["problemId"] = json!(dst);
            r["reason"] = json!(format!("[Merged from {title}] {}", r.text("reason")));
        }
        for p in self
            .state
            .problems
            .iter_mut()
            .filter(|p| p["canonicalId"] == src)
        {
            p["canonicalId"] = json!(dst)
        }
        for a in self
            .state
            .attachments
            .iter_mut()
            .filter(|a| a["targetType"] == "problem" && a["targetId"] == src)
        {
            a["targetId"] = json!(dst)
        }
        self.update_problem(src, &json!({"status":"Duplicate","canonicalId":dst}))?;
        self.update_problem(dst, &json!({}))?;
        self.actor_event(
            src,
            "merged",
            reason,
            Some(result["source"].text("status")),
            Some("Duplicate"),
        );
        self.actor_event(
            dst,
            "duplicate_merged",
            &format!("Merged “{title}”: {reason}"),
            None,
            None,
        );
        self.audit("duplicate_merge", src, &format!("{dst}: {reason}"));
        let old = result["target"].text("status");
        if result.num("affectedAfter") >= 2 && matches!(old, "Reported" | "Needs information") {
            self.state
                .problems
                .iter_mut()
                .find(|p| p["id"] == dst)
                .unwrap()["status"] = json!("Confirmed");
            self.event(
                dst,
                None,
                "community_confirmed",
                "Merged affected accounts establish confirmation.",
                Some(old),
                Some("Confirmed"),
            );
        }
        self.notify(dst, "Duplicate merged", reason)?;
        result["source"] = self.present(self.problem(src, true)?)?;
        result["target"] = self.present(self.problem(dst, true)?)?;
        Ok(result)
    }
    fn verify_solution(&mut self, id: &str, d: &Row) -> Result<Row> {
        let sol = self.sol(id)?;
        let pid = sol.text("problemId").to_owned();
        if sol["authorId"] == self.actor {
            return Err(err(
                403,
                "self_verification",
                "You cannot verify your own solution.",
            ));
        }
        let verify = d["decision"] == "verified";
        if sol.flag("hidden") && verify {
            return Err(err(
                409,
                "hidden",
                "Restore this solution before verifying it.",
            ));
        }
        if self.latest(id)?["id"] != d["revisionId"] {
            return Err(err(
                409,
                "outdated_revision",
                "Only the current revision can be verified.",
            ));
        }
        if verify
            && !self.state.tests.iter().any(|t| {
                t["revisionId"] == d["revisionId"]
                    && t["userId"] != sol["authorId"]
                    && matches!(t.text("outcome"), "Worked" | "Partially worked")
            })
        {
            return Err(err(
                422,
                "insufficient_evidence",
                "At least one independent applicable successful test is required.",
            ));
        }
        self.problem(&pid, false)?;
        let mut row = d.clone();
        row.extend(&json!({"id":self.id(),"reviewerId":self.actor,"createdAt":self.now}));
        self.state.verifications.push(row);
        let kind = format!("solution_{}", d.text("decision"));
        let reason = d.text("reason");
        self.audit(&kind, id, reason);
        self.actor_event(&pid, &kind, reason, None, None);
        if !verify {
            self.reopen_unverified(
                &pid,
                "reopened",
                "The last applicable verification was revoked.",
            )?
        }
        self.notify(&pid, "Verification updated", reason)?;
        self.solution(self.sol(id)?)
    }
    pub(super) fn moderate(&mut self, op: &str, id: &str, d: &Row) -> Result<Row> {
        self.moderator()?;
        let reason = d.text("reason");
        match op {
            "verify" => self.verify_solution(id, d),
            "merge" => self.merge(d),
            "status" => {
                let p = self.problem(id, false)?;
                let from = p.text("status").to_owned();
                let to = d.text("status");
                match to {
                    "Duplicate" => {
                        return Err(err(
                            422,
                            "merge_required",
                            "Use duplicate merging to select a canonical problem.",
                        ));
                    }
                    "Confirmed"
                        if self
                            .state
                            .participation
                            .iter()
                            .filter(|r| r["problemId"] == id && r["kind"] == "affected")
                            .count()
                            < 2 =>
                    {
                        return Err(err(
                            422,
                            "insufficient_confirmation",
                            "Two distinct affected accounts are required.",
                        ));
                    }
                    "Resolved" | "Partially solved" if self.verified_count(id) == 0 => {
                        return Err(err(
                            422,
                            "verification_required",
                            "A current verified solution is required.",
                        ));
                    }
                    "Reopened"
                        if !matches!(from.as_str(), "Resolved" | "Closed" | "Partially solved") =>
                    {
                        return Err(err(
                            409,
                            "invalid_status",
                            "Only closed or solved problems can be reopened.",
                        ));
                    }
                    _ => (),
                }
                self.update_problem(
                    id,
                    &json!({"status":to,"resolvedAt":(to=="Resolved").then_some(&self.now)}),
                )?;
                self.actor_event(id, "status_changed", reason, Some(&from), Some(to));
                self.audit("problem_status", id, reason);
                self.notify(id, &format!("Problem {}", to.to_lowercase()), reason)?;
                self.present(self.problem(id, false)?)
            }
            "hide" => {
                let kind = d.text("targetType");
                let target = d.text("targetId");
                let collection = match kind {
                    "problem" => &mut self.state.problems,
                    "solution" => &mut self.state.solutions,
                    _ => &mut self.state.comments,
                };
                let row = collection
                    .iter_mut()
                    .find(|r| r["id"] == target)
                    .ok_or(missing("Content not found."))?;
                row["hidden"] = d["hidden"].clone();
                let hidden = d.flag("hidden");
                let pid = row.text("problemId").to_owned();
                if kind == "solution" && hidden {
                    self.reopen_unverified(
                        &pid,
                        "reopened",
                        "The last verified solution was hidden.",
                    )?
                }
                self.audit(
                    if hidden {
                        "content_hidden"
                    } else {
                        "content_restored"
                    },
                    target,
                    reason,
                );
                Ok(json!({"ok":true}))
            }
            "restrict" => {
                let p = self.profile(id)?;
                if id == self.actor {
                    return Err(err(
                        422,
                        "self_restriction",
                        "You cannot restrict your own account.",
                    ));
                }
                if matches!(p.text("role"), "moderator" | "admin")
                    && self.profile(&self.actor)?["role"] != "admin"
                {
                    return Err(err(
                        403,
                        "forbidden",
                        "Only an administrator can restrict moderators.",
                    ));
                }
                let p = self
                    .state
                    .profiles
                    .iter_mut()
                    .find(|p| p["id"] == id)
                    .unwrap();
                p["restricted"] = d["restricted"].clone();
                let out = p.clone();
                self.audit(
                    if d.flag("restricted") {
                        "account_restricted"
                    } else {
                        "account_restored"
                    },
                    id,
                    reason,
                );
                Ok(out)
            }
            "resolveReport" => {
                let r = self
                    .state
                    .reports
                    .iter_mut()
                    .find(|r| r["id"] == id)
                    .ok_or(missing("Report not found."))?;
                r["state"] = json!("resolved");
                let out = r.clone();
                self.audit("report_resolved", id, reason);
                Ok(out)
            }
            _ => Err(err(500, "internal_error", "Unknown tracker operation.")),
        }
    }
}
