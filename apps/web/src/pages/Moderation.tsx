import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  EyeOff,
  FileSearch,
  GitMerge,
  History,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import {
  statuses,
  testStats,
  type ModerationData,
  type MergePreview,
  type Problem,
  type Profile,
  type Solution,
  type ModerationReport,
} from '@tracker/contracts';
import { command } from '../api';
import { sessionRole } from '../browser';
import { useModalAccessibility } from '../modal';
import { useSession } from '../context';
import { AuthPrompt } from './Account';
import {
  Avatar,
  Empty,
  ErrorState,
  Field,
  Loading,
  PageHeading,
  PlainText,
  Status,
  shortDate,
  useLoad,
} from '../ui';

type Action =
  | { kind: 'verify'; solution: Solution }
  | { kind: 'status'; problem: Problem }
  | { kind: 'content'; targetType: string; targetId: string; hidden: boolean; title: string }
  | { kind: 'restrict'; profile: Profile }
  | { kind: 'resolve'; report: ModerationReport };
export default function ModerationPage() {
  const { profile, loading, notice } = useSession();
  const moderator = sessionRole(profile) === 'moderator';
  const result = useLoad(
    () => (moderator ? command<ModerationData>('moderation') : Promise.resolve(null)),
    [profile?.id, moderator],
  );
  const [tab, setTab] = useState('review'),
    [action, setAction] = useState<Action | null>(null);
  const [sourceId, setSourceId] = useState(''),
    [targetId, setTargetId] = useState(''),
    [mergeReason, setMergeReason] = useState(''),
    [preview, setPreview] = useState<MergePreview | null>(null),
    [mergeBusy, setMergeBusy] = useState(false),
    [mergeError, setMergeError] = useState('');
  if (loading) return <Loading />;
  if (!profile)
    return (
      <AuthPrompt
        title="The moderator workspace."
        description="Sign in with a moderator account to review evidence and keep the community useful."
      />
    );
  if (!moderator)
    return (
      <div className="empty-state">
        <ShieldCheck size={35} />
        <h1>This workspace is for moderators</h1>
        <p>You can report concerns from any problem, solution, comment, or profile.</p>
        <Link className="button secondary" to="/">
          Back to community
        </Link>
      </div>
    );
  if (result.loading && !result.data) return <Loading label="Loading the moderation workspace…" />;
  if (result.error) return <ErrorState error={result.error} retry={result.reload} />;
  if (!result.data) return null;
  const data = result.data;
  const openReports = data.reports.filter((report) => report.state === 'open');
  const reviewSolutions = tab === 'solutions' ? data.solutions : data.verificationQueue;
  function reportParent(report: ModerationReport) {
    return report.targetType === 'problem'
      ? report.targetId
      : report.targetType === 'solution'
        ? data.solutions.find((solution) => solution.id === report.targetId)?.problemId
        : report.targetType === 'comment'
          ? data.comments.find((comment) => comment.id === report.targetId)?.problemId
          : undefined;
  }
  function reportHidden(report: ModerationReport) {
    return report.targetType === 'problem'
      ? data.problems.find((problem) => problem.id === report.targetId)?.hidden
      : report.targetType === 'solution'
        ? data.solutions.find((solution) => solution.id === report.targetId)?.hidden
        : report.targetType === 'comment'
          ? data.comments.find((comment) => comment.id === report.targetId)?.hidden
          : false;
  }
  async function getPreview(event: FormEvent) {
    event.preventDefault();
    setMergeBusy(true);
    setMergeError('');
    try {
      setPreview(await command<MergePreview>('mergePreview', undefined, { sourceId, targetId }));
    } catch (err) {
      setMergeError((err as Error).message);
    } finally {
      setMergeBusy(false);
    }
  }
  async function merge() {
    setMergeBusy(true);
    setMergeError('');
    try {
      await command('merge', undefined, { sourceId, targetId, reason: mergeReason });
      setPreview(null);
      setSourceId('');
      setTargetId('');
      setMergeReason('');
      result.reload();
      notice('Duplicate merged. Its old address now redirects to the canonical problem.');
    } catch (err) {
      setMergeError((err as Error).message);
    } finally {
      setMergeBusy(false);
    }
  }
  const people = new Map(data.profiles.map((person) => [person.id, person.displayName]));
  return (
    <div className="moderation-page">
      <PageHeading
        eyebrow="COMMUNITY TRUST"
        title="Moderation workspace"
        description="Review the evidence. Keep the history. Explain the decision."
        action={
          <span className="role-badge">
            <ShieldCheck size={15} />
            {profile.role === 'admin' ? 'Administrator' : 'Moderator'}
          </span>
        }
      />
      <div className="moderation-stats">
        <div>
          <FileSearch size={22} />
          <strong>{data.verificationQueue.length}</strong>
          <span>solution reviews</span>
        </div>
        <div>
          <AlertTriangle size={22} />
          <strong>{openReports.length}</strong>
          <span>open reports</span>
        </div>
        <div>
          <Users size={22} />
          <strong>{data.profiles.filter((person) => person.restricted).length}</strong>
          <span>restricted accounts</span>
        </div>
      </div>
      <nav className="detail-tabs moderation-tabs" aria-label="Moderation sections">
        {[
          ['review', 'Solution reviews'],
          ['solutions', 'All solutions'],
          ['comments', 'Discussion'],
          ['reports', 'Reports'],
          ['problems', 'Problems'],
          ['accounts', 'Accounts'],
          ['merge', 'Merge duplicates'],
          ['audit', 'Action history'],
        ].map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? 'active' : ''}
            aria-current={tab === key ? 'page' : undefined}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      {(tab === 'review' || tab === 'solutions') && (
        <section className="moderation-list">
          {reviewSolutions.length === 0 ? (
            <Empty title="No solutions waiting for review">
              <p>New and revised solutions appear here once submitted.</p>
            </Empty>
          ) : (
            reviewSolutions.map((solution) => {
              const revision = solution.currentRevision;
              const stats = testStats(revision.tests);
              return (
                <article
                  className={`moderation-card ${solution.hidden ? 'hidden-content' : ''}`}
                  key={solution.id}
                >
                  <div className="solution-top">
                    <span className="revision-label">Revision {revision.number}</span>
                    <span className="muted">By {solution.author.displayName}</span>
                    {revision.verification?.decision === 'verified' && (
                      <span className="solution-state is-verified">Verified</span>
                    )}
                  </div>
                  <h2>{revision.title}</h2>
                  <div className="moderation-scope">
                    <strong>Supported setup</strong>
                    <PlainText>{revision.supportedSetup}</PlainText>
                  </div>
                  <p>
                    <strong>{stats.counts.Worked}</strong> worked ·{' '}
                    <strong>{stats.counts['Partially worked']}</strong> partially worked ·{' '}
                    <strong>{stats.counts['Did not work']}</strong> did not work ·{' '}
                    <strong>{stats.counts['Not applicable']}</strong> not applicable
                  </p>
                  <details>
                    <summary>Review instructions and test evidence</summary>
                    <PlainText>{revision.instructions}</PlainText>
                    {revision.tests.map((test) => (
                      <div key={test.id} className="test-record">
                        <strong>{test.outcome}</strong>
                        <small>{people.get(test.userId) || 'Community member'}</small>
                        <PlainText>{test.setup}</PlainText>
                        <PlainText>{test.evidence || 'No additional evidence provided.'}</PlainText>
                      </div>
                    ))}
                  </details>
                  <div className="button-row">
                    <Link className="button secondary small" to={`/problems/${solution.problemId}`}>
                      View problem
                      <ArrowRight size={15} />
                    </Link>
                    <button
                      className="button small"
                      disabled={solution.authorId === profile.id}
                      onClick={() => setAction({ kind: 'verify', solution })}
                    >
                      <ShieldCheck size={16} />
                      {revision.verification?.decision === 'verified'
                        ? 'Review verification'
                        : 'Review & verify'}
                    </button>
                    <button
                      className="text-link danger"
                      onClick={() =>
                        setAction({
                          kind: 'content',
                          targetType: 'solution',
                          targetId: solution.id,
                          hidden: !solution.hidden,
                          title: revision.title,
                        })
                      }
                    >
                      <EyeOff size={15} />
                      {solution.hidden ? 'Restore' : 'Hide'} solution
                    </button>
                  </div>
                  {solution.authorId === profile.id && (
                    <p className="fine-print">
                      You cannot verify your own solution. Another moderator must review it.
                    </p>
                  )}
                </article>
              );
            })
          )}
        </section>
      )}
      {tab === 'reports' && (
        <section className="moderation-list">
          {data.reports.length === 0 ? (
            <Empty title="No reported concerns" />
          ) : (
            data.reports.map((report) => (
              <article key={report.id} className="moderation-card">
                <div className="card-top">
                  <span
                    className={`status ${report.state === 'open' ? 'status-reported' : 'status-resolved'}`}
                  >
                    {report.state === 'open' ? 'Open report' : 'Resolved report'}
                  </span>
                  <small>{shortDate(report.createdAt)}</small>
                </div>
                <h2>{report.reason}</h2>
                <PlainText>{report.details}</PlainText>
                <p className="fine-print">
                  Target: {report.targetType} · {report.targetId} · Reported by{' '}
                  {people.get(report.reporterId) || 'a community member'}
                </p>
                <div className="button-row">
                  {reportParent(report) && (
                    <Link
                      className="button secondary small"
                      to={`/problems/${reportParent(report)}`}
                    >
                      View problem
                    </Link>
                  )}
                  {report.targetType === 'profile' && (
                    <Link className="button secondary small" to={`/profiles/${report.targetId}`}>
                      View profile
                    </Link>
                  )}
                  {report.state === 'open' && (
                    <>
                      <button
                        className="button small"
                        onClick={() => setAction({ kind: 'resolve', report })}
                      >
                        <CheckCircle2 size={16} />
                        Resolve report
                      </button>
                      {report.targetType !== 'profile' && (
                        <button
                          className="text-link danger"
                          onClick={() =>
                            setAction({
                              kind: 'content',
                              targetType: report.targetType,
                              targetId: report.targetId,
                              hidden: !reportHidden(report),
                              title: report.reason,
                            })
                          }
                        >
                          {reportHidden(report)
                            ? 'Restore reported content'
                            : 'Hide reported content'}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </article>
            ))
          )}
        </section>
      )}
      {tab === 'problems' && (
        <section className="moderation-list">
          {data.problems.map((problem) => (
            <article
              className={`moderation-card ${problem.hidden ? 'hidden-content' : ''}`}
              key={problem.id}
            >
              <div className="card-top">
                <span className="category-label">{problem.category}</span>
                <Status status={problem.status} />
                {problem.hidden && <span className="sample-label">Hidden</span>}
              </div>
              <h2>{problem.title}</h2>
              <p className="muted">
                {problem.affectedCount} affected · {problem.verifiedCount} verified current fixes
              </p>
              <div className="button-row">
                <Link className="button secondary small" to={`/problems/${problem.id}`}>
                  View problem
                </Link>
                <button
                  className="button small"
                  disabled={problem.status === 'Duplicate'}
                  onClick={() => setAction({ kind: 'status', problem })}
                >
                  Change status
                </button>
                <button
                  className="text-link danger"
                  onClick={() =>
                    setAction({
                      kind: 'content',
                      targetType: 'problem',
                      targetId: problem.id,
                      hidden: !problem.hidden,
                      title: problem.title,
                    })
                  }
                >
                  {problem.hidden ? 'Restore problem' : 'Hide problem'}
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
      {tab === 'comments' && (
        <section className="moderation-list">
          {data.comments.length === 0 ? (
            <Empty title="No discussion contributions yet" />
          ) : (
            data.comments.map((comment) => (
              <article
                key={comment.id}
                className={`moderation-card ${comment.hidden ? 'hidden-content' : ''}`}
              >
                <div className="comment-author">
                  <Avatar profile={comment.author} />
                  <strong>{comment.author.displayName}</strong>
                  <span>{shortDate(comment.createdAt)}</span>
                  {comment.hidden && <span className="sample-label">Hidden</span>}
                </div>
                <PlainText>{comment.body}</PlainText>
                <div className="button-row">
                  <Link className="button secondary small" to={`/problems/${comment.problemId}`}>
                    View problem
                  </Link>
                  <button
                    className="text-link danger"
                    onClick={() =>
                      setAction({
                        kind: 'content',
                        targetType: 'comment',
                        targetId: comment.id,
                        hidden: !comment.hidden,
                        title: 'Discussion contribution',
                      })
                    }
                  >
                    {comment.hidden ? 'Restore comment' : 'Hide comment'}
                  </button>
                </div>
              </article>
            ))
          )}
        </section>
      )}
      {tab === 'accounts' && (
        <section className="moderation-list">
          {data.profiles.map((person) => (
            <article className="moderation-card account-review" key={person.id}>
              <Avatar profile={person} />
              <div>
                <Link to={`/profiles/${person.id}`}>
                  <h2>{person.displayName}</h2>
                </Link>
                <p>
                  @{person.username} · {person.role}
                  {person.restricted ? ' · Restricted' : ''}
                </p>
              </div>
              <button
                className="button secondary small"
                disabled={person.id === profile.id}
                onClick={() => setAction({ kind: 'restrict', profile: person })}
              >
                {person.restricted ? 'Remove restriction' : 'Restrict account'}
              </button>
            </article>
          ))}
        </section>
      )}
      {tab === 'merge' && (
        <section className="merge-panel">
          <div className="rail-card">
            <h2>
              <GitMerge size={22} />
              Preserve one canonical problem
            </h2>
            <p>
              Merge only when the reports describe the same issue. Contributions and history are
              preserved, and participation is deduplicated by account.
            </p>
            <form onSubmit={getPreview}>
              <div className="field-grid">
                <Field label="Duplicate to merge" required>
                  <select
                    required
                    value={sourceId}
                    onChange={(event) => {
                      setSourceId(event.target.value);
                      setPreview(null);
                    }}
                  >
                    <option value="">Choose the duplicate</option>
                    {data.problems
                      .filter((problem) => problem.status !== 'Duplicate')
                      .map((problem) => (
                        <option key={problem.id} value={problem.id}>
                          {problem.title}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Canonical problem to keep" required>
                  <select
                    required
                    value={targetId}
                    onChange={(event) => {
                      setTargetId(event.target.value);
                      setPreview(null);
                    }}
                  >
                    <option value="">Choose the canonical problem</option>
                    {data.problems
                      .filter(
                        (problem) => problem.id !== sourceId && problem.status !== 'Duplicate',
                      )
                      .map((problem) => (
                        <option key={problem.id} value={problem.id}>
                          {problem.title}
                        </option>
                      ))}
                  </select>
                </Field>
              </div>
              <button
                className="button secondary"
                disabled={mergeBusy || !sourceId || !targetId || sourceId === targetId}
              >
                <FileSearch size={17} />
                {mergeBusy ? 'Checking…' : 'Preview merge'}
              </button>
            </form>
            {preview && (
              <div className="merge-preview">
                <h3>Review the result before merging</h3>
                <p>
                  <strong>{preview.source.title}</strong>
                  <ArrowRight size={16} />
                  <strong>{preview.target.title}</strong>
                </p>
                <table>
                  <thead>
                    <tr>
                      <th>Participation</th>
                      <th>Combined before</th>
                      <th>Distinct after</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Affected accounts</td>
                      <td>{preview.affectedBefore}</td>
                      <td>{preview.affectedAfter}</td>
                    </tr>
                    <tr>
                      <td>Upvotes</td>
                      <td>{preview.votesBefore}</td>
                      <td>{preview.votesAfter}</td>
                    </tr>
                    <tr>
                      <td>Followers</td>
                      <td>{preview.followersBefore}</td>
                      <td>{preview.followersAfter}</td>
                    </tr>
                  </tbody>
                </table>
                <Field label="Recorded reason" required>
                  <textarea
                    rows={3}
                    minLength={10}
                    maxLength={2000}
                    value={mergeReason}
                    onChange={(e) => setMergeReason(e.target.value)}
                  />
                </Field>
                <button
                  className="button"
                  disabled={mergeBusy || mergeReason.trim().length < 10}
                  onClick={() => void merge()}
                >
                  <GitMerge size={17} />
                  {mergeBusy ? 'Merging…' : 'Merge into canonical problem'}
                </button>
              </div>
            )}
            {mergeError && (
              <p className="inline-error" role="alert">
                {mergeError}
              </p>
            )}
          </div>
        </section>
      )}
      {tab === 'audit' && (
        <section className="audit-panel">
          <h2>Recorded moderation decisions</h2>
          {data.audit.length === 0 ? (
            <Empty title="No moderation actions yet" />
          ) : (
            <ol className="timeline">
              {data.audit.map((event) => (
                <li key={event.id}>
                  <span className="timeline-dot" />
                  <div>
                    <strong>{event.action.replaceAll('_', ' ')}</strong>
                    <PlainText>{event.reason}</PlainText>
                    <small>
                      {people.get(event.actorId) || event.actorId} ·{' '}
                      {new Date(event.createdAt).toLocaleString()} · {event.targetId}
                    </small>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
      {action && (
        <ActionDialog
          key={`${action.kind}-${'targetId' in action ? action.targetId : 'solution' in action ? action.solution.id : 'profile' in action ? action.profile.id : 'problem' in action ? action.problem.id : action.report.id}`}
          action={action}
          onClose={() => setAction(null)}
          onSaved={() => {
            setAction(null);
            result.reload();
          }}
        />
      )}
    </div>
  );
}
function ActionDialog({
  action,
  onClose,
  onSaved,
}: {
  action: Action;
  onClose: () => void;
  onSaved: () => void;
}) {
  useModalAccessibility(true, onClose);
  const { notice } = useSession();
  const [reason, setReason] = useState(''),
    [evidence, setEvidence] = useState(''),
    [scope, setScope] = useState(
      action.kind === 'verify' ? action.solution.currentRevision.supportedSetup : '',
    ),
    [decision, setDecision] = useState('verified'),
    [status, setStatus] = useState(
      action.kind === 'status' ? action.problem.status : 'Investigating',
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const title =
    action.kind === 'verify'
      ? 'Review solution verification'
      : action.kind === 'status'
        ? 'Update the problem status'
        : action.kind === 'restrict'
          ? action.profile.restricted
            ? 'Remove account restriction'
            : 'Restrict this account'
          : action.kind === 'resolve'
            ? 'Resolve the report'
            : action.hidden
              ? 'Hide this contribution'
              : 'Restore this contribution';
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await command('moderate', undefined, { action, evidence, scope, reason, decision, status });
      notice('Decision saved with its reason in the moderation history.');
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="moderation-action-title"
        onSubmit={submit}
      >
        <button
          type="button"
          className="icon-button modal-close"
          aria-label="Cancel moderation action"
          onClick={onClose}
        >
          <X />
        </button>
        <h2 id="moderation-action-title">{title}</h2>
        <p>
          Every decision needs a clear reason. The server validates your permission and the current
          record.
        </p>
        {action.kind === 'verify' && (
          <>
            <div className="warning-box">
              Verification requires an independent successful or partial test on this revision.
              Check the evidence and supported scope; authors cannot verify their own fixes.
            </div>
            <Field label="Decision">
              <select value={decision} onChange={(e) => setDecision(e.target.value)}>
                <option value="verified">Verify this revision</option>
                <option value="revoked">Revoke verification</option>
              </select>
            </Field>
            <Field label="Evidence reviewed" required>
              <textarea
                required
                minLength={10}
                maxLength={12000}
                rows={4}
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
                placeholder="Which independent tests support this decision?"
              />
            </Field>
            <Field label="Verified supported scope" required>
              <textarea
                required
                minLength={3}
                maxLength={2000}
                rows={3}
                value={scope}
                onChange={(e) => setScope(e.target.value)}
              />
            </Field>
          </>
        )}
        {action.kind === 'status' && (
          <>
            <Field label="New status">
              <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                {statuses
                  .filter((item) => item !== 'Duplicate')
                  .map((item) => (
                    <option key={item}>{item}</option>
                  ))}
              </select>
            </Field>
            <p className="fine-print">
              A resolved problem requires a current verified fix that covers the reported scope. Use
              the duplicate merge workflow for duplicate reports.
            </p>
          </>
        )}
        <Field label="Reason for the decision" required>
          <textarea
            required
            minLength={10}
            maxLength={2000}
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <button className="button" disabled={busy}>
          {busy ? 'Saving decision…' : 'Save moderation decision'}
        </button>
      </form>
    </div>
  );
}
