use super::*;
use std::cmp::Reverse;
impl Engine {
    fn public_profile(&self, id: &str) -> Result<Row> {
        let p = self.profile(id)?;
        let mut out = json!({});
        for key in [
            "id",
            "username",
            "displayName",
            "bio",
            "expertise",
            "role",
            "createdAt",
        ] {
            out[key] = p[key].clone()
        }
        if !p.text("avatarUrl").is_empty() {
            out["avatarUrl"] = p["avatarUrl"].clone()
        }
        Ok(out)
    }
    fn attachments(&self, ty: &str, id: &str) -> Vec<Row> {
        self.state
            .attachments
            .iter()
            .filter(|a| a["targetType"] == ty && a["targetId"] == id)
            .map(|a| self.attachment_view(a))
            .collect()
    }
    pub(super) fn attachment_view(&self, r: &Row) -> Row {
        let mut a = r.clone();
        let obj = a.as_object_mut().expect("attachment record");
        obj.remove("data");
        obj.remove("storagePath");
        a["url"] = json!(format!(
            "{}/api/v1/attachments/{}",
            self.public_url,
            a.text("id")
        ));
        a
    }
    pub(super) fn latest(&self, id: &str) -> Result<&Row> {
        self.state
            .revisions
            .iter()
            .filter(|r| r["solutionId"] == id)
            .max_by_key(|r| r.num("number"))
            .ok_or(missing("Revision not found."))
    }
    fn verification(&self, rid: &str) -> Option<&Row> {
        self.state
            .verifications
            .iter()
            .filter(|r| r["revisionId"] == rid)
            .max_by(|a, b| a.text("createdAt").cmp(b.text("createdAt")))
    }
    fn verified(&self, sol: &Row) -> bool {
        self.latest(sol.text("id"))
            .ok()
            .and_then(|r| self.verification(r.text("id")))
            .is_some_and(|v| v["decision"] == "verified")
    }
    pub(super) fn verified_count(&self, id: &str) -> usize {
        self.state
            .solutions
            .iter()
            .filter(|s| s["problemId"] == id && !s.flag("hidden") && self.verified(s))
            .count()
    }
    pub(super) fn solution(&self, sol: &Row) -> Result<Row> {
        let id = sol.text("id");
        let mut revs = self
            .state
            .revisions
            .iter()
            .filter(|r| r["solutionId"] == id)
            .collect::<Vec<_>>();
        revs.sort_by_key(|r| Reverse(r.num("number")));
        let revisions = revs
            .into_iter()
            .map(|r| {
                let mut rev = r.clone();
                rev.as_object_mut().unwrap().remove("solutionId");
                rev["tests"] = json!(
                    self.state
                        .tests
                        .iter()
                        .filter(|t| t["revisionId"] == r["id"])
                        .collect::<Vec<_>>()
                );
                rev["verification"] = json!(self.verification(r.text("id")));
                rev
            })
            .collect::<Vec<_>>();
        let mut result = sol.clone();
        result.extend(&json!({"author":self.public_profile(sol.text("authorId"))?,"currentRevision":revisions.first(),"revisions":revisions,"attachments":self.attachments("solution",id)}));
        Ok(result)
    }
    pub(super) fn present(&self, p: &Row) -> Result<Row> {
        let id = p.text("id");
        let mut counts = [0usize; 3];
        let mut fresh = [0usize; 2];
        let mut viewer = json!({"affected":false,"voted":false,"following":false,"setup":""});
        for r in self
            .state
            .participation
            .iter()
            .filter(|r| r["problemId"] == id)
        {
            let (i, key) = match r.text("kind") {
                "affected" => (0, "affected"),
                "vote" => (1, "voted"),
                "follow" => (2, "following"),
                _ => continue,
            };
            counts[i] += 1;
            if i < 2 && timestamp(r.text("createdAt")) >= self.ms.saturating_sub(7 * 86400000) {
                fresh[i] += 1
            }
            if r["userId"] == self.actor {
                viewer[key] = json!(true);
                if i == 0 {
                    viewer["setup"] = r["setup"].clone()
                }
            }
        }
        let mut sol_count = 0;
        let mut verified = 0;
        for s in self
            .state
            .solutions
            .iter()
            .filter(|s| s["problemId"] == id && !s.flag("hidden"))
        {
            sol_count += 1;
            verified += usize::from(self.verified(s));
        }
        let mut out = p.clone();
        out.extend(&json!({"author":self.public_profile(p.text("authorId"))?,"affectedCount":counts[0],"voteCount":counts[1],"followerCount":counts[2],"solutionCount":sol_count,"verifiedCount":verified,"recentAffectedCount":fresh[0],"recentVoteCount":fresh[1],"viewer":viewer,"attachments":self.attachments("problem",id)}));
        Ok(out)
    }
    pub(super) fn comment_view(&self, c: &Row) -> Result<Row> {
        let mut out = c.clone();
        out["author"] = self.public_profile(c.text("authorId"))?;
        Ok(out)
    }
    fn detail(&self, id: &str) -> Result<Row> {
        let p = self.problem(id, true)?;
        let visible = |r: &&Row| r["problemId"] == id && (!r.flag("hidden") || self.is_mod());
        let solutions = self
            .state
            .solutions
            .iter()
            .filter(visible)
            .map(|s| self.solution(s))
            .collect::<Result<Vec<_>>>()?;
        let comments = self
            .state
            .comments
            .iter()
            .filter(visible)
            .map(|c| self.comment_view(c))
            .collect::<Result<Vec<_>>>()?;
        let mut timeline = self
            .state
            .timeline
            .iter()
            .filter(|r| r["problemId"] == id)
            .collect::<Vec<_>>();
        timeline.sort_by(|a, b| a.text("createdAt").cmp(b.text("createdAt")));
        let related = self
            .state
            .problems
            .iter()
            .filter(|r| {
                r["id"] != id
                    && !r.flag("hidden")
                    && r["canonicalId"].is_null()
                    && r["category"] == p["category"]
            })
            .take(3)
            .map(|p| self.present(p))
            .collect::<Result<Vec<_>>>()?;
        let mut out = json!({"problem":self.present(p)?,"solutions":solutions,"comments":comments,"timeline":timeline,"related":related});
        if !p["canonicalId"].is_null() {
            out["redirectId"] = p["canonicalId"].clone()
        }
        Ok(out)
    }
    fn feed(&self, d: &Row) -> Result<Row> {
        let sort = d.text("sort");
        let q = d.text("q").to_lowercase();
        let terms = q.split_whitespace().collect::<Vec<_>>();
        let mut items = Vec::new();
        for p in &self.state.problems {
            if p.flag("hidden")
                || !p["canonicalId"].is_null()
                || (!d.text("category").is_empty() && p["category"] != d["category"])
                || (sort == "unsolved" && matches!(p.text("status"), "Resolved" | "Closed"))
                || (sort == "solved" && p["status"] != "Resolved")
            {
                continue;
            }
            if !terms.is_empty() {
                let text = [p.text("title"), p.text("description"), p.text("product")]
                    .into_iter()
                    .chain(
                        p["tags"]
                            .as_array()
                            .into_iter()
                            .flatten()
                            .filter_map(Value::as_str),
                    )
                    .collect::<Vec<_>>()
                    .join(" ")
                    .to_lowercase();
                if !terms.iter().all(|t| text.contains(t)) {
                    continue;
                }
            }
            items.push(self.present(p)?);
        }
        items.sort_by(|a, b| match sort {
            "affected" => b.num("affectedCount").cmp(&a.num("affectedCount")),
            "trending" => b
                .num("recentAffectedCount")
                .cmp(&a.num("recentAffectedCount"))
                .then_with(|| b.num("recentVoteCount").cmp(&a.num("recentVoteCount")))
                .then_with(|| b.text("createdAt").cmp(a.text("createdAt"))),
            "solved" => b.text("resolvedAt").cmp(a.text("resolvedAt")),
            _ => b.text("createdAt").cmp(a.text("createdAt")),
        });
        let total = items.len();
        Ok(
            json!({"total":total,"items":items.into_iter().skip(d.num("offset") as usize).take(50).collect::<Vec<_>>()}),
        )
    }
    pub(super) fn read(&self, op: &str, id: &str, d: &Row) -> Result<Option<Row>> {
        let s = &self.state;
        Ok(Some(match op {
            "me" => self.profile(&self.actor)?.clone(),
            "detail" => self.detail(id)?,
            "feed" => self.feed(d)?,
            "getSolution" => {
                let sol = self.sol(id)?;
                self.problem(sol.text("problemId"), false)?;
                if sol.flag("hidden") && !self.is_mod() {
                    return Err(missing("Solution not found."));
                }
                self.solution(sol)?
            }
            "notifications" => {
                let mut rows = s
                    .notifications
                    .iter()
                    .filter(|n| n["userId"] == self.actor)
                    .collect::<Vec<_>>();
                rows.sort_by(|a, b| b.text("createdAt").cmp(a.text("createdAt")));
                rows.truncate(100);
                json!(rows)
            }
            "following" => json!(
                s.problems
                    .iter()
                    .filter(|p| !p.flag("hidden")
                        && p["canonicalId"].is_null()
                        && s.participation.iter().any(|r| r["problemId"] == p["id"]
                            && r["userId"] == self.actor
                            && r["kind"] == "follow"))
                    .map(|p| self.present(p))
                    .collect::<Result<Vec<_>>>()?
            ),
            "publicProfile" => {
                if !s.profiles.iter().any(|p| p["id"] == id) {
                    return Err(missing("Profile not found."));
                }
                json!({"profile":self.public_profile(id)?,"problems":s.problems.iter().filter(|p|p["authorId"]==id && !p.flag("hidden") && p["canonicalId"].is_null()).map(|p|self.present(p)).collect::<Result<Vec<_>>>()?,
                    "solutions":s.solutions.iter().filter(|r|r["authorId"]==id && !r.flag("hidden") && s.problems.iter().any(|p|p["id"]==r["problemId"] && !p.flag("hidden") && p["canonicalId"].is_null())).map(|r|self.solution(r)).collect::<Result<Vec<_>>>()?})
            }
            "moderation" => {
                self.moderator()?;
                let solutions = s
                    .solutions
                    .iter()
                    .map(|r| self.solution(r))
                    .collect::<Result<Vec<_>>>()?;
                json!({"reports":s.reports.iter().filter(|r|r["state"]=="open").collect::<Vec<_>>(),"verificationQueue":solutions.iter().filter(|r|!r.flag("hidden") && r["currentRevision"]["verification"]["decision"]!="verified").collect::<Vec<_>>(),"solutions":solutions,"comments":s.comments.iter().map(|c|self.comment_view(c)).collect::<Result<Vec<_>>>()?,"profiles":s.profiles,"audit":s.audit.iter().rev().take(100).collect::<Vec<_>>(),"problems":s.problems.iter().filter(|r|r["canonicalId"].is_null()).map(|p|self.present(p)).collect::<Result<Vec<_>>>()?})
            }
            "mergePreview" => self.preview(d.text("sourceId"), d.text("targetId"))?,
            "authorizeUpload" => {
                self.authorize_upload(d)?;
                json!(true)
            }
            "image" | "authorizeDeletion" => {
                let a = s
                    .attachments
                    .iter()
                    .find(|a| a["id"] == id)
                    .ok_or(missing("Image not found."))?;
                if op == "image" {
                    let t = self.target(a.text("targetType"), a.text("targetId"))?;
                    if t.flag("hidden") && !self.is_mod() {
                        return Err(missing("Image not found."));
                    }
                    self.problem(
                        if a["targetType"] == "problem" {
                            a.text("targetId")
                        } else {
                            t.text("problemId")
                        },
                        true,
                    )?;
                } else {
                    if self.profile(&self.actor)?.flag("restricted") {
                        return Err(err(403, "restricted", "Your account is restricted."));
                    }
                    if a["ownerId"] != self.actor {
                        return Err(err(
                            403,
                            "forbidden",
                            "Only the uploader can delete this image.",
                        ));
                    }
                }
                a.clone()
            }
            _ => return Ok(None),
        }))
    }
}
