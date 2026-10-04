import type {
  Profile,
  Problem,
  Solution,
  ProblemDetail,
  FeedSort,
  TargetType,
  Attachment,
} from '@tracker/contracts';
import {
  problemInputSchema,
  solutionInputSchema,
  participationSchema,
  solutionTestSchema,
  verificationSchema,
  statusChangeSchema,
  profileSchema,
  reportSchema,
} from '@tracker/contracts';
import { z } from 'zod';
import {
  id,
  now,
  fail,
  isModerator,
  type State,
  type Store,
  type StoredProblem,
  type StoredRevision,
  type StoredAttachment,
} from './state.js';
import type { ProductionStore } from './store.js';

const reasonSchema = z.object({ reason: z.string().trim().min(10).max(2000) }).strict();
export class TrackerService {
  constructor(
    public store: Store,
    private publicUrl: string,
  ) {}
  private profile(s: State, userId: string) {
    return (
      s.profiles.find((x) => x.id === userId) ?? fail(401, 'unauthorized', 'Please sign in again.')
    );
  }
  private publicProfileValue(p: Profile) {
    return {
      id: p.id,
      username: p.username,
      displayName: p.displayName,
      bio: p.bio,
      expertise: p.expertise,
      role: p.role,
      createdAt: p.createdAt,
      ...(p.avatarUrl ? { avatarUrl: p.avatarUrl } : {}),
    };
  }
  private problem(s: State, problemId: string, actor?: string | null, allowDuplicate = false) {
    const p =
      s.problems.find((x) => x.id === problemId) ?? fail(404, 'not_found', 'Problem not found.');
    if (p.hidden && !isModerator(s.profiles.find((x) => x.id === actor)))
      fail(404, 'not_found', 'Problem not found.');
    if (!allowDuplicate && p.canonicalId)
      fail(409, 'duplicate', 'This problem has been merged. Open the canonical problem.');
    return p;
  }
  private moderator(s: State, userId: string) {
    if (!isModerator(this.profile(s, userId)))
      fail(403, 'forbidden', 'Only moderators can perform this action.');
  }
  private capacity(s: State) {
    if (!this.store.demo) {
      const rows = Object.entries(s)
        .filter(([key]) => key !== 'version')
        .reduce((n, [, v]) => n + (v as unknown[]).length, 0);
      if (rows > 2500 || JSON.stringify(s).length > 750000)
        fail(
          503,
          'beta_capacity',
          'The beta has reached its safe capacity. Contact the platform owner.',
        );
    }
  }
  private write<T>(actor: string, fn: (s: State) => T) {
    return this.store.transaction((s) => {
      const p = this.profile(s, actor);
      if (p.restricted) fail(403, 'restricted', 'Your account is restricted. Contact a moderator.');
      const window = Math.floor(Date.now() / 60000);
      s.limits = s.limits.filter((x) => x.window >= window - 1);
      let limit = s.limits.find((x) => x.userId === actor && x.window === window);
      if (!limit) {
        limit = { id: `${actor}-${window}`, userId: actor, window, count: 0 };
        s.limits.push(limit);
      }
      if (limit.count >= 40)
        fail(429, 'rate_limited', 'Too many changes. Wait a minute and try again.');
      limit.count++;
      const result = fn(s);
      this.capacity(s);
      return result;
    });
  }
  private event(
    s: State,
    actor: string | null,
    problemId: string,
    kind: string,
    reason: string,
    fromStatus: StoredProblem['status'] | null = null,
    toStatus: StoredProblem['status'] | null = null,
  ) {
    s.timeline.push({
      id: id(),
      problemId,
      actorId: actor,
      kind,
      reason,
      fromStatus,
      toStatus,
      createdAt: now(),
    });
  }
  private audit(s: State, actor: string, action: string, targetId: string, reason: string) {
    s.audit.push({ id: id(), actorId: actor, action, targetId, reason, createdAt: now() });
  }
  private reopenWithoutVerification(
    s: State,
    p: StoredProblem,
    actor: string,
    kind: string,
    reason: string,
  ) {
    if (
      !['Resolved', 'Partially solved'].includes(p.status) ||
      this.present(s, p).verifiedCount > 0
    )
      return;
    const from = p.status;
    p.status = 'Reopened';
    p.resolvedAt = null;
    p.version++;
    p.updatedAt = now();
    this.event(s, actor, p.id, kind, reason, from, 'Reopened');
  }
  private notify(s: State, p: StoredProblem, actor: string, title: string, body: string) {
    const recipients = new Set([
      p.authorId,
      ...s.participation
        .filter((x) => x.problemId === p.id && x.kind === 'follow')
        .map((x) => x.userId),
    ]);
    for (const userId of recipients)
      if (userId !== actor)
        s.notifications.push({
          id: id(),
          userId,
          problemId: p.id,
          title,
          body,
          read: false,
          createdAt: now(),
        });
  }
  private attachments(s: State, type: 'problem' | 'solution', targetId: string): Attachment[] {
    return s.attachments
      .filter((a) => a.targetType === type && a.targetId === targetId)
      .map(({ data, storagePath, ...a }) => ({
        ...a,
        url: `${this.publicUrl}/api/v1/attachments/${a.id}`,
      }));
  }
  private revision(s: State, r: StoredRevision) {
    const { solutionId, ...rev } = r;
    return {
      ...rev,
      tests: s.tests.filter((t) => t.revisionId === r.id),
      verification:
        s.verifications
          .filter((v) => v.revisionId === r.id)
          .sort(
            (a, b) =>
              b.createdAt.localeCompare(a.createdAt) ||
              s.verifications.indexOf(b) - s.verifications.indexOf(a),
          )[0] ?? null,
    };
  }
  private solution(s: State, solutionId: string): Solution {
    const sol =
      s.solutions.find((x) => x.id === solutionId) ?? fail(404, 'not_found', 'Solution not found.');
    const revs = s.revisions
      .filter((r) => r.solutionId === sol.id)
      .sort((a, b) => b.number - a.number)
      .map((r) => this.revision(s, r));
    return {
      ...sol,
      author: this.publicProfileValue(this.profile(s, sol.authorId)),
      revisions: revs,
      currentRevision: revs[0]!,
      attachments: this.attachments(s, 'solution', sol.id),
    };
  }
  private present(s: State, p: StoredProblem, actor?: string | null): Problem {
    const parts = s.participation.filter((x) => x.problemId === p.id);
    const recent = Date.now() - 7 * 86400000;
    const sol = s.solutions
      .filter((x) => x.problemId === p.id && !x.hidden)
      .map((x) => this.solution(s, x.id));
    const count = (kind: string) => parts.filter((x) => x.kind === kind).length;
    const recentCount = (kind: string) =>
      parts.filter((x) => x.kind === kind && Date.parse(x.createdAt) >= recent).length;
    const affected = parts.find((x) => x.kind === 'affected' && x.userId === actor);
    return {
      ...p,
      author: this.publicProfileValue(this.profile(s, p.authorId)),
      affectedCount: count('affected'),
      voteCount: count('vote'),
      followerCount: count('follow'),
      solutionCount: sol.length,
      verifiedCount: sol.filter((x) => x.currentRevision.verification?.decision === 'verified')
        .length,
      recentAffectedCount: recentCount('affected'),
      recentVoteCount: recentCount('vote'),
      viewer: {
        affected: !!affected,
        voted: parts.some((x) => x.kind === 'vote' && x.userId === actor),
        following: parts.some((x) => x.kind === 'follow' && x.userId === actor),
        setup: affected?.setup ?? '',
      },
      attachments: this.attachments(s, 'problem', p.id),
    };
  }
  async ensureProfile(userId: string, displayName: string, avatarUrl?: string): Promise<Profile> {
    const existing = this.store.profile
      ? await this.store.profile(userId)
      : (await this.store.read()).profiles.find((p) => p.id === userId);
    if (existing) return existing;
    return this.store.transaction((state) => {
      const p = state.profiles.find((p) => p.id === userId);
      if (p) return p;
      const name = displayName.trim().slice(0, 80);
      const created: Profile = {
        id: userId,
        username: `member_${userId.replace(/-/g, '').slice(0, 12)}`,
        displayName: name.length >= 2 ? name : 'Community member',
        bio: '',
        expertise: [],
        role: 'member',
        restricted: false,
        createdAt: now(),
        ...(avatarUrl && /^https:\/\//.test(avatarUrl) ? { avatarUrl } : {}),
      };
      state.profiles.push(created);
      this.capacity(state);
      return created;
    });
  }
  async me(actor: string) {
    if (this.store.profile)
      return (
        (await this.store.profile(actor)) ?? fail(401, 'unauthorized', 'Please sign in again.')
      );
    return this.profile(await this.store.read(), actor);
  }
  async updateProfile(actor: string, input: unknown) {
    const data = profileSchema.parse(input);
    return this.write(actor, (s) => {
      if (
        s.profiles.some(
          (p) => p.id !== actor && p.username.toLowerCase() === data.username.toLowerCase(),
        )
      )
        fail(409, 'conflict', 'That username is already in use.');
      const p = this.profile(s, actor);
      Object.assign(p, data);
      return p;
    });
  }
  async feed(actor: string | null, sort: FeedSort, category?: string, q?: string, offset = 0) {
    if ('feed' in this.store)
      return (this.store as ProductionStore).feed({
        sort,
        category,
        q,
        viewerId: actor ?? undefined,
        offset,
      });
    const s = await this.store.read();
    let list = s.problems.filter(
      (p) => !p.hidden && !p.canonicalId && (!category || p.category === category),
    );
    if (q) {
      const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
      list = list.filter((p) =>
        terms.every((t) =>
          [p.title, p.description, p.product, ...p.tags].join(' ').toLowerCase().includes(t),
        ),
      );
    }
    if (sort === 'unsolved') list = list.filter((p) => !['Resolved', 'Closed'].includes(p.status));
    if (sort === 'solved') list = list.filter((p) => p.status === 'Resolved');
    const items = list.map((p) => this.present(s, p, actor));
    items.sort((a, b) =>
      sort === 'affected'
        ? b.affectedCount - a.affectedCount
        : sort === 'trending'
          ? b.recentAffectedCount - a.recentAffectedCount ||
            b.recentVoteCount - a.recentVoteCount ||
            b.createdAt.localeCompare(a.createdAt)
          : sort === 'solved'
            ? (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? '')
            : b.createdAt.localeCompare(a.createdAt),
    );
    return { items: items.slice(offset, offset + 50), total: items.length };
  }
  async detail(problemId: string, actor: string | null): Promise<ProblemDetail> {
    const s = await this.store.read(problemId);
    const p = this.problem(s, problemId, actor, true);
    const mod = isModerator(s.profiles.find((x) => x.id === actor));
    return {
      problem: this.present(s, p, actor),
      solutions: s.solutions
        .filter((x) => x.problemId === p.id && (!x.hidden || mod))
        .map((x) => this.solution(s, x.id)),
      comments: s.comments
        .filter((x) => x.problemId === p.id && (!x.hidden || mod))
        .map((x) => ({ ...x, author: this.publicProfileValue(this.profile(s, x.authorId)) })),
      timeline: s.timeline
        .filter((x) => x.problemId === p.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      related: s.problems
        .filter((x) => x.id !== p.id && !x.hidden && !x.canonicalId && x.category === p.category)
        .slice(0, 3)
        .map((x) => this.present(s, x, actor)),
      ...(p.canonicalId ? { redirectId: p.canonicalId } : {}),
    };
  }
  async createProblem(actor: string, input: unknown) {
    const data = problemInputSchema.parse(input);
    if (data.affected && data.setup.length < 3)
      fail(422, 'validation_error', 'Describe the setup where you experience this problem.');
    return this.write(actor, (s) => {
      if (s.problems.length >= 500 && !this.store.demo)
        fail(
          503,
          'beta_capacity',
          'The beta has reached its reporting capacity. Existing problems can still be investigated.',
        );
      const { affected, version, ...fields } = data;
      const p: StoredProblem = {
        ...fields,
        id: id(),
        authorId: actor,
        status: 'Reported',
        canonicalId: null,
        hidden: false,
        demo: this.store.demo,
        createdAt: now(),
        updatedAt: now(),
        resolvedAt: null,
        version: 1,
      };
      s.problems.push(p);
      if (affected)
        s.participation.push({
          id: id(),
          problemId: p.id,
          userId: actor,
          kind: 'affected',
          setup: data.setup,
          createdAt: now(),
        });
      s.participation.push({
        id: id(),
        problemId: p.id,
        userId: actor,
        kind: 'follow',
        setup: '',
        createdAt: now(),
      });
      this.event(s, actor, p.id, 'reported', 'Problem reported.', null, 'Reported');
      return this.present(s, p, actor);
    });
  }
  async editProblem(actor: string, problemId: string, input: unknown) {
    const data = problemInputSchema.parse(input);
    return this.write(actor, (s) => {
      const p = this.problem(s, problemId, actor);
      if (p.authorId !== actor) fail(403, 'forbidden', 'Only the author can edit this report.');
      if (data.version === undefined || data.version !== p.version)
        fail(409, 'concurrent_update', 'This report changed. Reload it before saving.');
      const material = ['setup', 'product', 'description', 'classification'].some(
        (k) => p[k as keyof typeof p] !== data[k as keyof typeof data],
      );
      const { affected, version, ...fields } = data;
      Object.assign(p, fields, { updatedAt: now(), version: p.version + 1 });
      if (material && ['Resolved', 'Partially solved'].includes(p.status)) {
        const from = p.status;
        p.status = 'Reopened';
        p.resolvedAt = null;
        this.event(
          s,
          actor,
          p.id,
          'scope_changed',
          'The author changed the reported scope. Existing solution evidence remains available.',
          from,
          'Reopened',
        );
      }
      this.event(s, actor, p.id, 'edited', 'The author updated the report.');
      return this.present(s, p, actor);
    });
  }
  async participate(actor: string, problemId: string, input: unknown) {
    const data = participationSchema.parse(input);
    return this.write(actor, (s) => {
      const p = this.problem(s, problemId, actor);
      const row = s.participation.find(
        (x) => x.problemId === p.id && x.userId === actor && x.kind === data.kind,
      );
      if (data.active) {
        if (row) row.setup = data.setup;
        else
          s.participation.push({
            id: id(),
            problemId: p.id,
            userId: actor,
            kind: data.kind,
            setup: data.setup,
            createdAt: now(),
          });
      } else if (row) s.participation = s.participation.filter((x) => x.id !== row.id);
      if (
        s.participation.filter((x) => x.problemId === p.id && x.kind === 'affected').length >= 2 &&
        ['Reported', 'Needs information'].includes(p.status)
      ) {
        const from = p.status;
        p.status = 'Confirmed';
        p.updatedAt = now();
        p.version++;
        this.event(
          s,
          null,
          p.id,
          'community_confirmed',
          'Two distinct accounts confirmed an affected setup.',
          from,
          p.status,
        );
        this.notify(s, p, actor, 'Problem confirmed', 'Two members now report this issue.');
      }
      if (
        p.status === 'Confirmed' &&
        s.participation.filter((x) => x.problemId === p.id && x.kind === 'affected').length < 2
      ) {
        p.status = 'Needs information';
        p.updatedAt = now();
        p.version++;
        this.event(
          s,
          null,
          p.id,
          'confirmation_withdrawn',
          'Fewer than two affected confirmations remain.',
          'Confirmed',
          'Needs information',
        );
      }
      return this.present(s, p, actor);
    });
  }
  async comment(actor: string, problemId: string, input: unknown) {
    const data = z
      .object({ body: z.string().trim().min(2).max(5000) })
      .strict()
      .parse(input);
    return this.write(actor, (s) => {
      const p = this.problem(s, problemId, actor);
      const comment = {
        id: id(),
        problemId: p.id,
        authorId: actor,
        body: data.body,
        hidden: false,
        createdAt: now(),
      };
      s.comments.push(comment);
      this.notify(s, p, actor, 'New discussion', data.body.slice(0, 160));
      return { ...comment, author: this.publicProfileValue(this.profile(s, actor)) };
    });
  }
  async addSolution(actor: string, problemId: string, input: unknown) {
    const data = solutionInputSchema.parse(input);
    return this.write(actor, (s) => {
      const p = this.problem(s, problemId, actor);
      const sol = {
        id: id(),
        problemId: p.id,
        authorId: actor,
        hidden: false,
        demo: this.store.demo,
        createdAt: now(),
        updatedAt: now(),
      };
      s.solutions.push(sol);
      s.revisions.push({ ...data, id: id(), solutionId: sol.id, number: 1, createdAt: now() });
      this.event(s, actor, p.id, 'solution_proposed', data.title);
      this.notify(s, p, actor, 'A fix was proposed', data.title);
      return this.solution(s, sol.id);
    });
  }
  async getSolution(solutionId: string, actor: string | null) {
    const s = await this.store.read();
    const sol =
      s.solutions.find((x) => x.id === solutionId) ?? fail(404, 'not_found', 'Solution not found.');
    this.problem(s, sol.problemId, actor);
    if (sol.hidden && !isModerator(s.profiles.find((x) => x.id === actor)))
      fail(404, 'not_found', 'Solution not found.');
    return this.solution(s, sol.id);
  }
  async editSolution(actor: string, solutionId: string, input: unknown) {
    const data = solutionInputSchema.parse(input);
    return this.write(actor, (s) => {
      const sol =
        s.solutions.find((x) => x.id === solutionId) ??
        fail(404, 'not_found', 'Solution not found.');
      this.problem(s, sol.problemId, actor);
      if (sol.authorId !== actor)
        fail(403, 'forbidden', 'Only the author can revise this solution.');
      if (sol.hidden) fail(409, 'hidden', 'Hidden solutions cannot be edited.');
      const current = this.solution(s, sol.id).currentRevision;
      const identical = Object.entries(data).every(
        ([k, v]) => current[k as keyof typeof current] === v,
      );
      if (identical) return this.solution(s, sol.id);
      s.revisions.push({
        ...data,
        id: id(),
        solutionId: sol.id,
        number: current.number + 1,
        createdAt: now(),
      });
      sol.updatedAt = now();
      const p = this.problem(s, sol.problemId, actor);
      this.reopenWithoutVerification(
        s,
        p,
        actor,
        'verification_invalidated',
        'The verified solution was materially revised. Previous test evidence is preserved.',
      );
      this.event(
        s,
        actor,
        p.id,
        'solution_revised',
        `Solution revision ${current.number + 1} requires fresh verification.`,
      );
      this.notify(s, p, actor, 'Solution revised', 'A new solution revision is ready for testing.');
      return this.solution(s, sol.id);
    });
  }
  async test(actor: string, solutionId: string, input: unknown) {
    const data = solutionTestSchema.parse(input);
    return this.write(actor, (s) => {
      const sol =
        s.solutions.find((x) => x.id === solutionId && !x.hidden) ??
        fail(404, 'not_found', 'Solution not found.');
      this.problem(s, sol.problemId, actor);
      if (!s.revisions.some((r) => r.id === data.revisionId && r.solutionId === sol.id))
        fail(422, 'invalid_revision', 'Choose a revision belonging to this solution.');
      const existing = s.tests.find((x) => x.userId === actor && x.revisionId === data.revisionId);
      if (existing) Object.assign(existing, data, { updatedAt: now() });
      else s.tests.push({ ...data, id: id(), userId: actor, createdAt: now(), updatedAt: now() });
      return this.solution(s, sol.id);
    });
  }
  async notifications(actor: string) {
    const s = await this.store.read();
    return s.notifications
      .filter((x) => x.userId === actor)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 100);
  }
  async markNotification(actor: string, notificationId: string) {
    return this.write(actor, (s) => {
      const n =
        s.notifications.find((x) => x.id === notificationId && x.userId === actor) ??
        fail(404, 'not_found', 'Notification not found.');
      n.read = true;
      return n;
    });
  }
  async following(actor: string) {
    const s = await this.store.read();
    return s.problems
      .filter(
        (p) =>
          !p.hidden &&
          !p.canonicalId &&
          s.participation.some(
            (x) => x.problemId === p.id && x.userId === actor && x.kind === 'follow',
          ),
      )
      .map((p) => this.present(s, p, actor));
  }
  async publicProfile(profileId: string, actor: string | null) {
    const s = await this.store.read();
    const profile =
      s.profiles.find((x) => x.id === profileId) ?? fail(404, 'not_found', 'Profile not found.');
    return {
      profile: this.publicProfileValue(profile),
      problems: s.problems
        .filter((x) => x.authorId === profileId && !x.hidden && !x.canonicalId)
        .map((x) => this.present(s, x, actor)),
      solutions: s.solutions
        .filter(
          (x) =>
            x.authorId === profileId &&
            !x.hidden &&
            s.problems.some((p) => p.id === x.problemId && !p.hidden && !p.canonicalId),
        )
        .map((x) => this.solution(s, x.id)),
    };
  }
  private target(s: State, type: TargetType, targetId: string) {
    const collection =
      type === 'profile'
        ? s.profiles
        : type === 'problem'
          ? s.problems
          : type === 'solution'
            ? s.solutions
            : s.comments;
    return (
      collection.find((x) => x.id === targetId) ?? fail(404, 'not_found', 'Content not found.')
    );
  }
  async report(actor: string, input: unknown) {
    const data = reportSchema.parse(input);
    return this.write(actor, (s) => {
      this.target(s, data.targetType, data.targetId);
      const previous = s.reports.find(
        (r) =>
          r.reporterId === actor &&
          r.targetType === data.targetType &&
          r.targetId === data.targetId &&
          r.state === 'open',
      );
      if (previous) return previous;
      const r = { ...data, id: id(), reporterId: actor, state: 'open' as const, createdAt: now() };
      s.reports.push(r);
      return r;
    });
  }
  async reopen(actor: string, problemId: string, input: unknown) {
    const { reason } = reasonSchema.parse(input);
    return this.write(actor, (s) => {
      const p = this.problem(s, problemId, actor);
      if (!['Resolved', 'Closed', 'Partially solved'].includes(p.status))
        fail(409, 'invalid_status', 'This problem is already open.');
      const existing = s.reports.find(
        (r) =>
          r.reporterId === actor &&
          r.targetId === p.id &&
          r.reason === 'Reopen request' &&
          r.state === 'open',
      );
      if (existing) return existing;
      const r = {
        id: id(),
        reporterId: actor,
        targetType: 'problem' as const,
        targetId: p.id,
        reason: 'Reopen request',
        details: reason,
        state: 'open' as const,
        createdAt: now(),
      };
      s.reports.push(r);
      this.event(s, actor, p.id, 'reopen_requested', reason);
      return r;
    });
  }
  async moderation(actor: string) {
    const s = await this.store.read();
    this.moderator(s, actor);
    return {
      reports: s.reports.filter((x) => x.state === 'open'),
      verificationQueue: s.solutions
        .filter((x) => !x.hidden)
        .map((x) => this.solution(s, x.id))
        .filter((x) => x.currentRevision.verification?.decision !== 'verified'),
      solutions: s.solutions.map((x) => this.solution(s, x.id)),
      comments: s.comments.map((x) => ({
        ...x,
        author: this.publicProfileValue(this.profile(s, x.authorId)),
      })),
      profiles: s.profiles,
      audit: s.audit.slice(-100).reverse(),
      problems: s.problems.filter((x) => !x.canonicalId).map((x) => this.present(s, x, actor)),
    };
  }
  async verify(actor: string, solutionId: string, input: unknown) {
    const data = verificationSchema.parse(input);
    return this.write(actor, (s) => {
      this.moderator(s, actor);
      const sol =
        s.solutions.find((x) => x.id === solutionId) ??
        fail(404, 'not_found', 'Solution not found.');
      if (sol.authorId === actor)
        fail(403, 'self_verification', 'You cannot verify your own solution.');
      if (sol.hidden && data.decision === 'verified')
        fail(409, 'hidden', 'Restore this solution before verifying it.');
      const current = this.solution(s, sol.id).currentRevision;
      if (current.id !== data.revisionId)
        fail(409, 'outdated_revision', 'Only the current revision can be verified.');
      if (
        data.decision === 'verified' &&
        !s.tests.some(
          (t) =>
            t.revisionId === data.revisionId &&
            t.userId !== sol.authorId &&
            ['Worked', 'Partially worked'].includes(t.outcome),
        )
      )
        fail(
          422,
          'insufficient_evidence',
          'At least one independent applicable successful test is required.',
        );
      s.verifications.push({ ...data, id: id(), reviewerId: actor, createdAt: now() });
      this.audit(s, actor, `solution_${data.decision}`, sol.id, data.reason);
      const p = this.problem(s, sol.problemId, actor);
      this.event(s, actor, p.id, `solution_${data.decision}`, data.reason);
      if (data.decision === 'revoked')
        this.reopenWithoutVerification(
          s,
          p,
          actor,
          'reopened',
          'The last applicable verification was revoked.',
        );
      this.notify(s, p, actor, 'Verification updated', data.reason);
      return this.solution(s, sol.id);
    });
  }
  async status(actor: string, problemId: string, input: unknown) {
    const data = statusChangeSchema.parse(input);
    return this.write(actor, (s) => {
      this.moderator(s, actor);
      const p = this.problem(s, problemId, actor);
      if (data.status === 'Duplicate')
        fail(422, 'merge_required', 'Use duplicate merging to select a canonical problem.');
      if (data.status === 'Confirmed' && this.present(s, p).affectedCount < 2)
        fail(422, 'insufficient_confirmation', 'Two distinct affected accounts are required.');
      if (
        ['Resolved', 'Partially solved'].includes(data.status) &&
        this.present(s, p).verifiedCount === 0
      )
        fail(422, 'verification_required', 'A current verified solution is required.');
      if (
        data.status === 'Reopened' &&
        !['Resolved', 'Closed', 'Partially solved'].includes(p.status)
      )
        fail(409, 'invalid_status', 'Only closed or solved problems can be reopened.');
      const from = p.status;
      p.status = data.status;
      p.resolvedAt = data.status === 'Resolved' ? now() : null;
      p.updatedAt = now();
      p.version++;
      this.event(s, actor, p.id, 'status_changed', data.reason, from, p.status);
      this.audit(s, actor, 'problem_status', p.id, data.reason);
      this.notify(s, p, actor, `Problem ${p.status.toLowerCase()}`, data.reason);
      return this.present(s, p, actor);
    });
  }
  async hide(actor: string, input: unknown) {
    const data = z
      .object({
        targetType: z.enum(['problem', 'solution', 'comment']),
        targetId: z.string().min(1),
        hidden: z.boolean(),
        reason: reasonSchema.shape.reason,
      })
      .strict()
      .parse(input);
    return this.write(actor, (s) => {
      this.moderator(s, actor);
      const target = this.target(s, data.targetType, data.targetId) as {
        hidden: boolean;
        problemId?: string;
      };
      target.hidden = data.hidden;
      if (data.targetType === 'solution' && data.hidden) {
        const p = this.problem(s, target.problemId!, actor);
        this.reopenWithoutVerification(
          s,
          p,
          actor,
          'reopened',
          'The last verified solution was hidden.',
        );
      }
      this.audit(
        s,
        actor,
        data.hidden ? 'content_hidden' : 'content_restored',
        data.targetId,
        data.reason,
      );
      return { ok: true };
    });
  }
  async restrict(actor: string, profileId: string, input: unknown) {
    const data = z
      .object({ restricted: z.boolean(), reason: reasonSchema.shape.reason })
      .strict()
      .parse(input);
    return this.write(actor, (s) => {
      this.moderator(s, actor);
      const p = this.profile(s, profileId);
      if (p.id === actor) fail(422, 'self_restriction', 'You cannot restrict your own account.');
      if (['moderator', 'admin'].includes(p.role) && this.profile(s, actor).role !== 'admin')
        fail(403, 'forbidden', 'Only an administrator can restrict moderators.');
      p.restricted = data.restricted;
      this.audit(
        s,
        actor,
        data.restricted ? 'account_restricted' : 'account_restored',
        p.id,
        data.reason,
      );
      return p;
    });
  }
  private preview(s: State, actor: string, sourceId: string, targetId: string) {
    this.moderator(s, actor);
    if (sourceId === targetId) fail(422, 'invalid_merge', 'Choose two different problems.');
    const source = this.problem(s, sourceId, actor);
    const target = this.problem(s, targetId, actor);
    const count = (kind: string, ids: string[]) =>
      s.participation.filter((x) => ids.includes(x.problemId) && x.kind === kind).length;
    const unique = (kind: string) =>
      new Set(
        s.participation
          .filter((x) => [sourceId, targetId].includes(x.problemId) && x.kind === kind)
          .map((x) => x.userId),
      ).size;
    return {
      source: this.present(s, source, actor),
      target: this.present(s, target, actor),
      affectedBefore: count('affected', [sourceId, targetId]),
      affectedAfter: unique('affected'),
      votesBefore: count('vote', [sourceId, targetId]),
      votesAfter: unique('vote'),
      followersBefore: count('follow', [sourceId, targetId]),
      followersAfter: unique('follow'),
    };
  }
  async mergePreview(actor: string, sourceId: string, targetId: string) {
    return this.preview(await this.store.read(), actor, sourceId, targetId);
  }
  async merge(actor: string, input: unknown) {
    const data = z
      .object({
        sourceId: z.string().min(1),
        targetId: z.string().min(1),
        reason: reasonSchema.shape.reason,
      })
      .strict()
      .parse(input);
    return this.write(actor, (s) => {
      const preview = this.preview(s, actor, data.sourceId, data.targetId);
      const source = this.problem(s, data.sourceId, actor);
      const target = this.problem(s, data.targetId, actor);
      for (const part of [...s.participation.filter((x) => x.problemId === source.id)]) {
        const other = s.participation.find(
          (x) => x.problemId === target.id && x.userId === part.userId && x.kind === part.kind,
        );
        if (other) {
          if (Date.parse(part.createdAt) < Date.parse(other.createdAt))
            other.createdAt = part.createdAt;
          if (part.setup && !other.setup) other.setup = part.setup;
          else if (part.kind === 'affected' && part.setup && part.setup !== other.setup)
            this.event(
              s,
              part.userId,
              target.id,
              'merged_affected_setup',
              `Additional affected setup preserved from ${source.title}: ${part.setup}`,
            );
          s.participation = s.participation.filter((x) => x.id !== part.id);
        } else part.problemId = target.id;
      }
      for (const sol of s.solutions) if (sol.problemId === source.id) sol.problemId = target.id;
      for (const c of s.comments) if (c.problemId === source.id) c.problemId = target.id;
      for (const event of s.timeline)
        if (event.problemId === source.id) {
          event.problemId = target.id;
          event.reason = `[Merged from ${source.title}] ${event.reason}`;
        }
      for (const n of s.notifications) if (n.problemId === source.id) n.problemId = target.id;
      for (const p of s.problems) if (p.canonicalId === source.id) p.canonicalId = target.id;
      for (const a of s.attachments.filter(
        (x) => x.targetType === 'problem' && x.targetId === source.id,
      )) {
        a.targetId = target.id;
      }
      const from = source.status;
      source.status = 'Duplicate';
      source.canonicalId = target.id;
      source.updatedAt = now();
      source.version++;
      target.updatedAt = now();
      target.version++;
      this.event(s, actor, source.id, 'merged', data.reason, from, 'Duplicate');
      this.event(
        s,
        actor,
        target.id,
        'duplicate_merged',
        `Merged “${source.title}”: ${data.reason}`,
      );
      this.audit(s, actor, 'duplicate_merge', source.id, `${target.id}: ${data.reason}`);
      if (
        this.present(s, target).affectedCount >= 2 &&
        ['Reported', 'Needs information'].includes(target.status)
      ) {
        const old = target.status;
        target.status = 'Confirmed';
        this.event(
          s,
          null,
          target.id,
          'community_confirmed',
          'Merged affected accounts establish confirmation.',
          old,
          'Confirmed',
        );
      }
      this.notify(s, target, actor, 'Duplicate merged', data.reason);
      return {
        ...preview,
        target: this.present(s, target, actor),
        source: this.present(s, source, actor),
      };
    });
  }
  async resolveReport(actor: string, reportId: string, input: unknown) {
    const { reason } = reasonSchema.parse(input);
    return this.write(actor, (s) => {
      this.moderator(s, actor);
      const r =
        s.reports.find((x) => x.id === reportId) ?? fail(404, 'not_found', 'Report not found.');
      r.state = 'resolved';
      this.audit(s, actor, 'report_resolved', r.id, reason);
      return r;
    });
  }
  async upload(actor: string, targetType: 'problem' | 'solution', targetId: string, file: File) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > 500 * 1024 || bytes.length === 0)
      fail(422, 'invalid_upload', 'Images must be nonempty and no larger than 500 KB.');
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const png = [137, 80, 78, 71, 13, 10, 26, 10].every((x, i) => bytes[i] === x);
    const webp =
      new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
      new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
    const mime = jpeg ? 'image/jpeg' : png ? 'image/png' : webp ? 'image/webp' : null;
    if (!mime || file.type !== mime)
      fail(422, 'invalid_upload', 'Upload a valid JPEG, PNG, or WebP image.');
    const attachmentId = id(),
      path = `${actor}/${attachmentId}.${jpeg ? 'jpg' : png ? 'png' : 'webp'}`;
    // Check authorization before storage side effects, and again in the atomic metadata write.
    const authorize = (s: State) => {
      const p = this.profile(s, actor);
      if (p.restricted) fail(403, 'restricted', 'Your account is restricted.');
      const target = this.target(s, targetType, targetId) as {
        authorId: string;
        hidden: boolean;
        problemId?: string;
      };
      if (target.authorId !== actor || target.hidden)
        fail(403, 'forbidden', 'Only the content author can attach images.');
      if (targetType === 'problem') this.problem(s, targetId, actor);
      else this.problem(s, target.problemId!, actor);
      if (
        s.attachments.filter(
          (x) => x.targetType === targetType && x.targetId === targetId && x.ownerId === actor,
        ).length >= 3
      )
        fail(422, 'attachment_limit', 'Use at most three images per contribution.');
    };
    authorize(await this.store.read());
    if (this.store.putImage) await this.store.putImage(path, bytes, mime);
    try {
      return await this.write(actor, (s) => {
        authorize(s);
        const a: StoredAttachment = {
          id: attachmentId,
          name: file.name.slice(0, 200),
          mimeType: mime,
          size: bytes.length,
          url: `${this.publicUrl}/api/v1/attachments/${attachmentId}`,
          targetType,
          targetId,
          ownerId: actor,
          ...(this.store.demo ? { data: bytesToBase64(bytes) } : { storagePath: path }),
        };
        s.attachments.push(a);
        const { data, storagePath, ...publicAttachment } = a;
        return publicAttachment;
      });
    } catch (error) {
      if (this.store.removeImage) await this.store.removeImage(path).catch(() => undefined);
      throw error;
    }
  }
  async image(attachmentId: string, actor: string | null) {
    const s = await this.store.read();
    const a =
      s.attachments.find((x) => x.id === attachmentId) ??
      fail(404, 'not_found', 'Image not found.');
    const target = this.target(s, a.targetType, a.targetId) as {
      hidden: boolean;
      problemId?: string;
    };
    if (target.hidden && !isModerator(s.profiles.find((x) => x.id === actor)))
      fail(404, 'not_found', 'Image not found.');
    this.problem(s, a.targetType === 'problem' ? a.targetId : target.problemId!, actor, true);
    const bytes = a.data ? base64ToBytes(a.data) : await this.store.getImage!(a.storagePath!);
    return { bytes, mime: a.mimeType };
  }
  async deleteImage(actor: string, attachmentId: string) {
    const before = await this.store.read();
    const a =
      before.attachments.find((x) => x.id === attachmentId) ??
      fail(404, 'not_found', 'Image not found.');
    if (this.profile(before, actor).restricted)
      fail(403, 'restricted', 'Your account is restricted.');
    if (a.ownerId !== actor) fail(403, 'forbidden', 'Only the uploader can delete this image.');
    // Preserve metadata if Storage fails so the owner can retry. Removing an
    // already absent object is idempotent in Storage, including a commit retry.
    if (a.storagePath && this.store.removeImage) await this.store.removeImage(a.storagePath);
    return this.write(actor, (s) => {
      const current = s.attachments.find((x) => x.id === attachmentId);
      if (current && current.ownerId !== actor)
        fail(403, 'forbidden', 'Only the uploader can delete this image.');
      s.attachments = s.attachments.filter((x) => x.id !== attachmentId);
      return { ok: true };
    });
  }
}
function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary);
}
function base64ToBytes(data: string) {
  return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
}
