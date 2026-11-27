import { useState, useEffect, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowUp,
  Bookmark,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Clock3,
  Edit3,
  ExternalLink,
  FlaskConical,
  MessageSquare,
  Plus,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import {
  outcomes,
  testStats,
  type ProblemDetail,
  type Problem,
  type Solution,
  type SolutionRevision,
  type TestOutcome,
} from '@tracker/contracts';
import { command } from '../api';
import { sessionRole } from '../browser';
import { useModalAccessibility } from '../modal';
import { useSession } from '../context';
import {
  Attachments,
  Avatar,
  Breadcrumb,
  Empty,
  ErrorState,
  Field,
  Loading,
  PlainText,
  ProblemCard,
  ReportButton,
  Status,
  useDraft,
  useLoad,
  shortDate,
  relativeDate,
} from '../ui';

export default function ProblemPage() {
  const { id } = useParams();
  return <ProblemDetailPage key={id} id={id} />;
}

function ProblemDetailPage({ id }: { id?: string }) {
  const navigate = useNavigate();
  const { profile, requireUser, notice } = useSession();
  const result = useLoad(() => command<ProblemDetail>('detail', id), [id, profile?.id]);
  const [affectedDialog, setAffectedDialog] = useState(false),
    [setup, setSetup] = useState(''),
    [participating, setParticipating] = useState(''),
    [partError, setPartError] = useState('');
  const [tab, setTab] = useState('solutions');
  const [comment, setComment, clearComment] = useDraft(`tracker.comment.${id}`, { body: '' });
  const [commentBusy, setCommentBusy] = useState(false),
    [commentError, setCommentError] = useState('');
  const [reopen, setReopen] = useState(false),
    [reason, setReason] = useState(''),
    [reopenBusy, setReopenBusy] = useState(false),
    [reopenError, setReopenError] = useState('');
  useModalAccessibility(affectedDialog, () => setAffectedDialog(false));
  useModalAccessibility(reopen, () => setReopen(false));
  useEffect(() => {
    if (result.data?.redirectId) {
      notice('This report was merged into the matching community problem.', 'info');
      navigate(`/problems/${result.data.redirectId}`, { replace: true });
    }
  }, [result.data?.redirectId, navigate, notice]);
  async function participate(
    kind: 'affected' | 'vote' | 'follow',
    active: boolean,
    customSetup = '',
  ) {
    if (!requireUser()) return;
    setParticipating(kind);
    setPartError('');
    try {
      const problem = await command<Problem>('participate', id, {
        kind,
        active,
        setup: customSetup,
      });
      result.setData((previous) => (previous ? { ...previous, problem } : previous));
      setAffectedDialog(false);
      if (kind === 'affected') result.reload();
      notice(
        kind === 'affected'
          ? active
            ? 'Your affected setup is recorded.'
            : 'Your affected confirmation was removed.'
          : kind === 'vote'
            ? active
              ? 'Your upvote is recorded.'
              : 'Upvote removed.'
            : active
              ? 'You’re following this problem.'
              : 'You unfollowed this problem.',
      );
    } catch (error) {
      setPartError((error as Error).message);
      notice((error as Error).message, 'error');
    } finally {
      setParticipating('');
    }
  }
  async function postComment(event: FormEvent) {
    event.preventDefault();
    if (!requireUser()) return;
    setCommentBusy(true);
    setCommentError('');
    try {
      await command('comment', id, { body: comment.body });
      setComment({ body: '' });
      clearComment();
      result.reload();
      notice('Your comment was added.');
    } catch (error) {
      setCommentError((error as Error).message);
    } finally {
      setCommentBusy(false);
    }
  }
  async function requestReopen(event: FormEvent) {
    event.preventDefault();
    setReopenBusy(true);
    setReopenError('');
    try {
      await command('reopen', id, { reason });
      setReopen(false);
      setReason('');
      result.reload();
      notice('Your reopening request is ready for a moderator to review.');
    } catch (error) {
      setReopenError((error as Error).message);
    } finally {
      setReopenBusy(false);
    }
  }
  if (result.loading && !result.data) return <Loading label="Opening the problem…" />;
  if (result.error) return <ErrorState error={result.error} retry={result.reload} />;
  if (!result.data) return null;
  const { problem, solutions, comments, timeline, related } = result.data;
  const isOwner = profile?.id === problem.authorId;
  const canWrite = ['member', 'moderator'].includes(sessionRole(profile));
  return (
    <div className="detail-page">
      <Breadcrumb current="Problem" />
      <div className="detail-layout">
        <section className="detail-main">
          <article className="detail-card">
            <div className="card-top">
              <span className={`category-label category-${problem.category.toLowerCase()}`}>
                {problem.category}
              </span>
              <span className="card-product">{problem.product}</span>
              <Status status={problem.status} />
              {problem.demo && <span className="sample-label">Sample issue</span>}
            </div>
            <h1>{problem.title}</h1>
            <div className="detail-meta">
              <Link to={`/profiles/${problem.author.id}`}>
                <Avatar profile={problem.author} />
                <strong>{problem.author.displayName}</strong>
              </Link>
              <span>Reported {shortDate(problem.createdAt)}</span>
              {isOwner && (
                <Link className="text-link" to={`/problems/${id}/edit`}>
                  <Edit3 size={14} />
                  Edit report
                </Link>
              )}
              <ReportButton targetType="problem" targetId={problem.id} />
            </div>
            <div className="detail-tags">
              {problem.tags.map((tag) => (
                <Link key={tag} to={`/?q=${encodeURIComponent(tag)}`}>
                  {tag}
                </Link>
              ))}
            </div>
            <div className="participation-bar">
              <button
                data-testid="affected-button"
                className={`participation-button ${problem.viewer.affected ? 'selected' : ''}`}
                disabled={!!participating}
                onClick={() => {
                  if (!requireUser()) return;
                  if (problem.viewer.affected) void participate('affected', false);
                  else {
                    setSetup(problem.viewer.setup || '');
                    setAffectedDialog(true);
                  }
                }}
              >
                <Users size={18} />
                <span>{problem.viewer.affected ? 'You’re affected' : 'I’m affected'}</span>
                <strong>{problem.affectedCount}</strong>
              </button>
              <button
                data-testid="vote-button"
                className={`participation-button ${problem.viewer.voted ? 'selected' : ''}`}
                disabled={!!participating}
                onClick={() => void participate('vote', !problem.viewer.voted)}
              >
                <ArrowUp size={18} />
                <span>Upvote</span>
                <strong>{problem.voteCount}</strong>
              </button>
              <button
                data-testid="follow-button"
                className={`participation-button ${problem.viewer.following ? 'selected' : ''}`}
                disabled={!!participating}
                onClick={() => void participate('follow', !problem.viewer.following)}
              >
                <Bookmark size={17} />
                <span>{problem.viewer.following ? 'Following' : 'Follow'}</span>
              </button>
            </div>
            <p className="participation-explainer">
              Affected means you experience this issue. Upvote means you think it deserves
              attention.
            </p>
            {partError && !affectedDialog && <p className="inline-error">{partError}</p>}
            <div className="detail-body">
              <h2>What’s happening</h2>
              <PlainText>{problem.description}</PlainText>
              {problem.symptoms && (
                <>
                  <h3>Symptoms</h3>
                  <PlainText>{problem.symptoms}</PlainText>
                </>
              )}
              {problem.steps && (
                <>
                  <h3>Steps to reproduce</h3>
                  <PlainText>{problem.steps}</PlainText>
                </>
              )}
              {problem.attemptedFixes && (
                <>
                  <h3>Already tried</h3>
                  <PlainText>{problem.attemptedFixes}</PlainText>
                </>
              )}
              <Attachments
                items={problem.attachments}
                targetType="problem"
                targetId={problem.id}
                ownerId={problem.authorId}
                refresh={result.reload}
              />
            </div>
          </article>
          <div className="detail-tabs" role="tablist" aria-label="Problem activity">
            <button
              role="tab"
              aria-selected={tab === 'solutions'}
              className={tab === 'solutions' ? 'active' : ''}
              onClick={() => setTab('solutions')}
            >
              <FlaskConical size={17} />
              Solutions<span>{solutions.length}</span>
            </button>
            <button
              role="tab"
              aria-selected={tab === 'discussion'}
              className={tab === 'discussion' ? 'active' : ''}
              onClick={() => setTab('discussion')}
            >
              <MessageSquare size={17} />
              Discussion<span>{comments.length}</span>
            </button>
            <button
              role="tab"
              aria-selected={tab === 'history'}
              className={tab === 'history' ? 'active' : ''}
              onClick={() => setTab('history')}
            >
              <Clock3 size={17} />
              History<span>{timeline.length}</span>
            </button>
          </div>
          {tab === 'solutions' && (
            <section>
              <div className="section-heading">
                <div>
                  <h2>Tested ideas move us forward</h2>
                  <p>Check the supported setup before trying a fix.</p>
                </div>
                <button
                  data-testid="propose-solution-button"
                  className="button small"
                  onClick={() => {
                    if (requireUser()) navigate(`/problems/${id}/solutions/new`);
                  }}
                >
                  <Plus size={16} />
                  Propose a fix
                </button>
              </div>
              {solutions.length === 0 ? (
                <Empty title="This problem is waiting for its first fix">
                  <p>
                    Know a workaround or have a promising idea? Document the steps and supported
                    setup.
                  </p>
                </Empty>
              ) : (
                solutions.map((solution) => (
                  <SolutionCard key={solution.id} solution={solution} refresh={result.reload} />
                ))
              )}
            </section>
          )}
          {tab === 'discussion' && (
            <section className="discussion-section">
              <h2>Investigate together</h2>
              <p className="muted">
                Share useful observations, reproduction details, and questions.
              </p>
              {comments.map((item) => (
                <article className="comment-card" key={item.id}>
                  <div className="comment-author">
                    <Link to={`/profiles/${item.author.id}`}>
                      <Avatar profile={item.author} />
                      <strong>{item.author.displayName}</strong>
                    </Link>
                    <span>{relativeDate(item.createdAt)}</span>
                    <ReportButton targetType="comment" targetId={item.id} />
                  </div>
                  <PlainText>{item.body}</PlainText>
                </article>
              ))}
              {comments.length === 0 && (
                <p className="muted discussion-empty">
                  No comments yet. Add the first observation.
                </p>
              )}
              <form className="comment-form" onSubmit={postComment}>
                <Field label="Your comment">
                  <textarea
                    placeholder="What have you noticed on your setup?"
                    minLength={3}
                    maxLength={5000}
                    rows={4}
                    value={comment.body}
                    onChange={(event) => setComment({ body: event.target.value })}
                    required
                  />
                </Field>
                {commentError && (
                  <p className="inline-error" role="alert">
                    {commentError}
                  </p>
                )}
                <div className="form-footer">
                  <small>Your unsent comment stays in this browser tab.</small>
                  <button className="button small" disabled={commentBusy || profile?.restricted}>
                    {commentBusy ? 'Posting…' : profile ? 'Post comment' : 'Sign in to comment'}
                  </button>
                </div>
              </form>
            </section>
          )}
          {tab === 'history' && (
            <section className="timeline-section">
              <h2>A permanent problem record</h2>
              <p className="muted">Status decisions and important changes stay visible.</p>
              <ol className="timeline">
                {timeline.map((event) => (
                  <li key={event.id}>
                    <span className="timeline-dot" />
                    <div>
                      <strong>
                        {event.toStatus
                          ? `${event.fromStatus ? `${event.fromStatus} → ` : ''}${event.toStatus}`
                          : event.kind.replaceAll('_', ' ')}
                      </strong>
                      <PlainText>{event.reason}</PlainText>
                      <small>{new Date(event.createdAt).toLocaleString()}</small>
                    </div>
                  </li>
                ))}
              </ol>
              {timeline.length === 0 && <p>No recorded status changes yet.</p>}
            </section>
          )}
        </section>
        <aside className="detail-aside">
          <section className="rail-card">
            <div className="rail-card-title">
              <h2>The reported setup</h2>
              <ClipboardList size={18} />
            </div>
            <dl className="setup-list">
              <dt>Product</dt>
              <dd>{problem.product}</dd>
              <dt>Type</dt>
              <dd>{problem.classification}</dd>
              <dt>Environment & versions</dt>
              <dd className="plain-text">{problem.setup || 'Not provided yet.'}</dd>
            </dl>
            {problem.viewer.affected && (
              <div className="your-setup">
                <CheckCircle2 size={16} />
                <strong>Your affected setup</strong>
                <p>{problem.viewer.setup}</p>
                <button
                  className="text-link"
                  onClick={() => {
                    setSetup(problem.viewer.setup);
                    setAffectedDialog(true);
                  }}
                >
                  Update setup
                </button>
              </div>
            )}
          </section>
          <section className="rail-card issue-progress">
            <h2>Community progress</h2>
            <div>
              <Users size={19} />
              <strong>{problem.affectedCount}</strong>
              <span>affected accounts</span>
            </div>
            <div>
              <FlaskConical size={19} />
              <strong>{problem.solutionCount}</strong>
              <span>proposed fixes</span>
            </div>
            <div>
              <ShieldCheck size={19} />
              <strong>{problem.verifiedCount}</strong>
              <span>verified current revisions</span>
            </div>
            <p className="fine-print">
              {problem.demo
                ? 'This is sample data for the demonstration.'
                : 'Counts reflect distinct participating accounts.'}
            </p>
          </section>
          {['Resolved', 'Closed', 'Partially solved'].includes(problem.status) && (
            <section className="rail-card">
              <h2>Still experiencing this?</h2>
              <p>A different setup or a new version may need another look.</p>
              <button
                className="button secondary small"
                onClick={() => {
                  if (requireUser()) setReopen(true);
                }}
              >
                Request reopening
              </button>
            </section>
          )}
          {related.length > 0 && (
            <section className="rail-card related-problems">
              <h2>Related problems</h2>
              {related.map((item) => (
                <Link key={item.id} to={`/problems/${item.id}`}>
                  <span>{item.title}</span>
                  <small>
                    <Users size={13} />
                    {item.affectedCount} affected
                  </small>
                </Link>
              ))}
            </section>
          )}
          <div className="rail-note">
            <ShieldCheck size={23} />
            <p>
              Verification applies to a specific revision and supported setup. It is not a guarantee
              for every device.
            </p>
          </div>
        </aside>
      </div>
      {affectedDialog && (
        <div className="modal-backdrop">
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="affected-title"
            onSubmit={(event) => {
              event.preventDefault();
              void participate('affected', true, setup);
            }}
          >
            <button
              type="button"
              className="icon-button modal-close"
              aria-label="Close affected confirmation"
              onClick={() => setAffectedDialog(false)}
            >
              <X />
            </button>
            <h2 id="affected-title">Add your affected setup</h2>
            <p>
              Useful details help the community understand which devices and versions experience
              this issue.
            </p>
            <Field
              label="Your setup"
              required
              hint="Product or device, operating system, version, and anything relevant."
            >
              <textarea
                value={setup}
                minLength={3}
                maxLength={2000}
                required
                rows={5}
                onChange={(event) => setSetup(event.target.value)}
              />
            </Field>
            {partError && <p className="inline-error">{partError}</p>}
            <button className="button" disabled={!!participating}>
              {participating ? 'Recording…' : 'Confirm I’m affected'}
            </button>
          </form>
        </div>
      )}
      {reopen && (
        <div className="modal-backdrop">
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reopen-title"
            onSubmit={requestReopen}
          >
            <button
              type="button"
              className="icon-button modal-close"
              aria-label="Close reopening request"
              onClick={() => setReopen(false)}
            >
              <X />
            </button>
            <h2 id="reopen-title">Request another investigation</h2>
            <p>
              Explain what changed and where the problem still occurs. A moderator will review your
              request.
            </p>
            <Field label="Reason and current setup" required>
              <textarea
                rows={5}
                minLength={10}
                maxLength={2000}
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            {reopenError && <p className="inline-error">{reopenError}</p>}
            <button className="button" disabled={reopenBusy}>
              {reopenBusy ? 'Sending…' : 'Send reopening request'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function SolutionCard({ solution, refresh }: { solution: Solution; refresh: () => void }) {
  const { profile, requireUser, notice } = useSession();
  const [testOpen, setTestOpen] = useState(false),
    [history, setHistory] = useState(false),
    [selectedRevision, setSelectedRevision] = useState(solution.currentRevision.id);
  const revision =
    solution.revisions.find((item) => item.id === selectedRevision) || solution.currentRevision;
  const mine = revision.tests.find((test) => test.userId === profile?.id);
  const [outcome, setOutcome] = useState<TestOutcome>(mine?.outcome || 'Worked'),
    [setup, setSetup] = useState(mine?.setup || ''),
    [evidence, setEvidence] = useState(mine?.evidence || ''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useModalAccessibility(testOpen, () => setTestOpen(false));
  const stats = testStats(revision.tests);
  const verified = revision.verification?.decision === 'verified';
  const old = revision.id !== solution.currentRevision.id;
  useEffect(() => setSelectedRevision(solution.currentRevision.id), [solution.currentRevision.id]);
  function openTest() {
    if (!requireUser()) return;
    setOutcome(mine?.outcome || 'Worked');
    setSetup(mine?.setup || '');
    setEvidence(mine?.evidence || '');
    setError('');
    setTestOpen(true);
  }
  async function test(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await command('test', solution.id, { revisionId: revision.id, outcome, setup, evidence });
      setTestOpen(false);
      refresh();
      notice('Your test result is recorded for this revision.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article
      data-testid={`solution-card-${solution.id}`}
      className={`solution-card ${verified ? 'verified-solution' : ''}`}
    >
      <div className="solution-top">
        <span className={`solution-state ${verified ? 'is-verified' : ''}`}>
          {verified ? <ShieldCheck size={16} /> : <FlaskConical size={16} />}
          {verified ? 'Moderator verified' : 'Community proposal'}
        </span>
        <span className="revision-label">
          Revision {revision.number}
          {old ? ' · Previous' : ''}
        </span>
        {solution.demo && <span className="sample-label">Sample fix</span>}
      </div>
      <h3>{revision.title}</h3>
      <div className="detail-meta">
        <Link to={`/profiles/${solution.authorId}`}>
          <Avatar profile={solution.author} />
          <strong>{solution.author.displayName}</strong>
        </Link>
        <span>{shortDate(revision.createdAt)}</span>
        {profile?.id === solution.authorId && (
          <Link className="text-link" to={`/solutions/${solution.id}/edit`}>
            <Edit3 size={14} />
            Create revision
          </Link>
        )}
        <ReportButton targetType="solution" targetId={solution.id} />
      </div>
      {old && (
        <div className="warning-box">
          You’re viewing an earlier revision. Its tests and verification do not apply to the current
          revision.
        </div>
      )}
      <div className="solution-scope">
        <span>SUPPORTED SETUP</span>
        <PlainText>{revision.supportedSetup}</PlainText>
      </div>
      <div className="solution-body">
        <h4>Steps to try</h4>
        <PlainText>{revision.instructions}</PlainText>
        {revision.reasoning && (
          <>
            <h4>Why this may help</h4>
            <PlainText>{revision.reasoning}</PlainText>
          </>
        )}
        {revision.limitations && (
          <>
            <h4>Limitations</h4>
            <PlainText>{revision.limitations}</PlainText>
          </>
        )}
        {revision.warnings && (
          <div className="warning-box">
            <strong>Before you try this</strong>
            <PlainText>{revision.warnings}</PlainText>
          </div>
        )}
        <Attachments
          items={solution.attachments}
          targetType="solution"
          targetId={solution.id}
          ownerId={solution.authorId}
          refresh={refresh}
        />
      </div>
      {verified && revision.verification && (
        <div className="verification-note">
          <ShieldCheck size={19} />
          <div>
            <strong>Reviewed against the evidence</strong>
            <p>{revision.verification.reason}</p>
            <small>Verified scope: {revision.verification.supportedScope}</small>
            <details>
              <summary>Review evidence</summary>
              <PlainText>{revision.verification.evidence}</PlainText>
            </details>
          </div>
        </div>
      )}
      <div className="test-summary">
        <div className="test-rate">
          <strong>{stats.successRate === null ? '—' : `${stats.successRate}%`}</strong>
          <span>
            {stats.successRate === null
              ? 'No applicable tests yet'
              : `worked in ${stats.applicable} applicable ${stats.applicable === 1 ? 'test' : 'tests'}`}
          </span>
        </div>
        <div className="outcome-counts">
          {outcomes.map((item) => (
            <span key={item}>
              <i className={`outcome-dot outcome-${outcomes.indexOf(item)}`} />
              <strong>{stats.counts[item]}</strong>
              {item}
            </span>
          ))}
        </div>
        <button className="button secondary small" onClick={openTest}>
          {mine ? 'Update my test' : 'I tested this'}
        </button>
      </div>
      <p className="test-denominator">
        “Not applicable” results are excluded from the success percentage. Partial results are shown
        separately.
      </p>
      {revision.tests.length > 0 && (
        <details className="test-details">
          <summary>Tested setups & evidence ({revision.tests.length})</summary>
          {revision.tests.map((item) => (
            <div className="test-record" key={item.id}>
              <strong>{item.outcome}</strong>
              <small>{shortDate(item.updatedAt)}</small>
              <PlainText>{item.setup}</PlainText>
              {item.evidence && <PlainText className="test-evidence">{item.evidence}</PlainText>}
            </div>
          ))}
        </details>
      )}
      {solution.revisions.length > 1 && (
        <div className="revision-history">
          <button className="text-link" onClick={() => setHistory(!history)}>
            {history ? <ChevronUp size={15} /> : <ChevronDown size={15} />}Revision history (
            {solution.revisions.length})
          </button>
          {history && (
            <div className="revision-choices">
              {solution.revisions.map((item) => (
                <button
                  key={item.id}
                  className={item.id === revision.id ? 'selected' : ''}
                  onClick={() => setSelectedRevision(item.id)}
                >
                  Revision {item.number} · {shortDate(item.createdAt)}
                  {item.id === solution.currentRevision.id ? ' · current' : ''}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {testOpen && (
        <div className="modal-backdrop">
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`test-title-${solution.id}`}
            onSubmit={test}
          >
            <button
              className="icon-button modal-close"
              type="button"
              aria-label="Close test result"
              onClick={() => setTestOpen(false)}
            >
              <X />
            </button>
            <h2 id={`test-title-${solution.id}`}>What happened on your setup?</h2>
            <p>Your result is attached to revision {revision.number}. You can update it later.</p>
            <Field label="Test outcome">
              <select
                value={outcome}
                onChange={(event) => setOutcome(event.target.value as TestOutcome)}
              >
                {outcomes.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </Field>
            <Field
              label="Tested setup"
              required
              hint="Include device, product, operating system and versions."
            >
              <textarea
                required
                minLength={3}
                maxLength={2000}
                rows={3}
                value={setup}
                onChange={(event) => setSetup(event.target.value)}
              />
            </Field>
            <Field label="Evidence and observations">
              <textarea
                maxLength={12000}
                rows={4}
                value={evidence}
                onChange={(event) => setEvidence(event.target.value)}
                placeholder="Which steps did you test? What changed?"
              />
            </Field>
            {error && <p className="inline-error">{error}</p>}
            <button className="button" disabled={busy}>
              {busy ? 'Saving…' : 'Save test result'}
            </button>
          </form>
        </div>
      )}
    </article>
  );
}
