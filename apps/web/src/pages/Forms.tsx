import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, FileText, Info, Save, Search, ShieldCheck } from 'lucide-react';
import {
  categories,
  problemInputSchema,
  solutionInputSchema,
  type Problem,
  type ProblemDetail,
  type ProblemInput,
  type Solution,
  type SolutionInput,
  type FeedResult,
} from '@tracker/contracts';
import { api, json, uploadImages } from '../api';
import { useSession } from '../context';
import {
  Breadcrumb,
  ErrorState,
  Field,
  ImagesInput,
  Loading,
  Status,
  useDraft,
  useLoad,
} from '../ui';

const problemDefaults: ProblemInput = {
  title: '',
  description: '',
  category: 'Computers',
  product: '',
  classification: 'Software',
  setup: '',
  symptoms: '',
  steps: '',
  attemptedFixes: '',
  tags: [],
  affected: true,
};
const solutionDefaults: SolutionInput = {
  title: '',
  instructions: '',
  reasoning: '',
  supportedSetup: '',
  limitations: '',
  warnings: '',
};
export function ProblemFormPage() {
  const { id } = useParams();
  const { profile, loading, openLogin } = useSession();
  const result = useLoad(
    () => (id ? api<ProblemDetail>(`/problems/${id}`) : Promise.resolve(null)),
    [id],
  );
  if (loading || result.loading) return <Loading label="Preparing the report form…" />;
  if (result.error) return <ErrorState error={result.error} retry={result.reload} />;
  if (id && result.data?.problem.authorId !== profile?.id)
    return (
      <div className="empty-state">
        <h1>This report belongs to another member</h1>
        <p>
          Only its author can edit the report. Moderators can change status and review concerns.
        </p>
        <Link className="button secondary" to={`/problems/${id}`}>
          Back to problem
        </Link>
      </div>
    );
  return <ProblemForm key={id || 'new'} problem={result.data?.problem} />;
}
function ProblemForm({ problem }: { problem?: Problem }) {
  const navigate = useNavigate();
  const { requireUser, notice, profile } = useSession();
  const initial: ProblemInput = problem
    ? {
        title: problem.title,
        description: problem.description,
        category: problem.category,
        product: problem.product,
        classification: problem.classification,
        setup: problem.setup,
        symptoms: problem.symptoms,
        steps: problem.steps,
        attemptedFixes: problem.attemptedFixes,
        tags: problem.tags,
        affected: problem.viewer.affected,
        version: problem.version,
      }
    : problemDefaults;
  const [form, setForm, clearDraft] = useDraft(`tracker.problem.${problem?.id || 'new'}`, initial);
  const [tags, setTags] = useState((form.tags || []).join(', ')),
    [files, setFiles] = useState<File[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [similar, setSimilar] = useState<Problem[]>([]),
    [searching, setSearching] = useState(false),
    [searchError, setSearchError] = useState('');
  useEffect(() => {
    if (problem || form.title.trim().length < 6) {
      setSimilar([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      setSearching(true);
      setSearchError('');
      void api<FeedResult>(`/problems?q=${encodeURIComponent(form.title)}&sort=trending`)
        .then((result) => {
          if (active) setSimilar(result.items.slice(0, 3));
        })
        .catch((err) => {
          if (active) setSearchError(err.message);
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 450);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [form.title, problem]);
  const update = <K extends keyof ProblemInput>(key: K, value: ProblemInput[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!requireUser()) return;
    setError('');
    const input = {
      ...form,
      tags: tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      ...(problem ? { version: problem.version } : {}),
    };
    const parsed = problemInputSchema.safeParse(input);
    if (!parsed.success) {
      setError(
        parsed.error.issues.map((issue) => `${issue.path.join(' ')}: ${issue.message}`).join(' '),
      );
      return;
    }
    if (!problem && form.affected && (form.setup?.trim().length || 0) < 3) {
      setError('Describe the setup where you are affected, or untick the affected confirmation.');
      return;
    }
    setBusy(true);
    try {
      const saved = await api<Problem>(problem ? `/problems/${problem.id}` : '/problems', {
        method: problem ? 'PATCH' : 'POST',
        body: json(parsed.data),
      });
      clearDraft();
      let uploadFailed = false;
      try {
        await uploadImages(files, 'problem', saved.id);
      } catch (err) {
        uploadFailed = true;
        notice(
          `Your report was saved, but a screenshot could not upload: ${(err as Error).message} Add it from the problem page.`,
          'error',
        );
      }
      if (!uploadFailed)
        notice(
          problem ? 'Your report is updated.' : 'Your problem is now part of the community record.',
        );
      navigate(`/problems/${saved.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="form-page">
      <Breadcrumb current={problem ? 'Edit report' : 'Report a problem'} problem={problem} />
      <div className="form-page-heading">
        <span className="eyebrow">MAKE THE PROBLEM UNDERSTANDABLE</span>
        <h1>{problem ? 'Update your report.' : 'Let’s figure it out, together.'}</h1>
        <p>
          {problem
            ? 'Keep the report accurate as you learn more. Status changes stay in the moderation workflow.'
            : 'A clear report makes it easier for others to confirm the issue and find a fix.'}
        </p>
      </div>
      <div className="form-layout">
        <form className="contribution-form" onSubmit={submit}>
          <section className="form-section">
            <div className="form-section-title">
              <span>01</span>
              <div>
                <h2>What’s happening?</h2>
                <p>Start with the issue, rather than a proposed explanation.</p>
              </div>
            </div>
            <Field
              label="Problem title"
              required
              hint="Describe the symptom and product in one specific sentence."
            >
              <input
                data-testid="problem-title-input"
                value={form.title}
                onChange={(e) => update('title', e.target.value)}
                minLength={10}
                maxLength={180}
                required
                placeholder="e.g. Wi-Fi drops after waking my laptop from sleep"
              />
            </Field>
            {!problem && (similar.length > 0 || searching || searchError) && (
              <div className="similar-problems">
                <h3>
                  <Search size={16} />
                  {searching
                    ? 'Looking for similar reports…'
                    : 'Check whether this has already been reported'}
                </h3>
                {similar.map((item) => (
                  <Link key={item.id} to={`/problems/${item.id}`}>
                    <span>{item.title}</span>
                    <Status status={item.status} />
                    <ArrowRight size={15} />
                  </Link>
                ))}
                {searchError && (
                  <p className="inline-error">
                    Duplicate suggestions are unavailable. You can still submit a distinct report.
                  </p>
                )}
                {!searching && similar.length > 0 && (
                  <p>
                    Join a matching problem or continue if yours is different. Nothing is merged
                    automatically.
                  </p>
                )}
              </div>
            )}
            <Field
              label="Describe the problem"
              required
              hint="What did you expect? What actually happened? How does it affect you?"
            >
              <textarea
                data-testid="problem-description-input"
                value={form.description}
                onChange={(e) => update('description', e.target.value)}
                minLength={30}
                maxLength={12000}
                rows={5}
                required
                placeholder="Include enough context for someone else to understand the issue."
              />
            </Field>
            <Field label="Symptoms">
              <textarea
                value={form.symptoms}
                onChange={(e) => update('symptoms', e.target.value)}
                maxLength={12000}
                rows={3}
                placeholder="Error messages, frequency, or things you can observe."
              />
            </Field>
          </section>
          <section className="form-section">
            <div className="form-section-title">
              <span>02</span>
              <div>
                <h2>Where does it happen?</h2>
                <p>Versions and hardware often make the difference.</p>
              </div>
            </div>
            <div className="field-grid">
              <Field label="Category" required>
                <select
                  value={form.category}
                  onChange={(e) => update('category', e.target.value as ProblemInput['category'])}
                >
                  {categories.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
              </Field>
              <Field label="Problem type" required>
                <select
                  value={form.classification}
                  onChange={(e) =>
                    update('classification', e.target.value as ProblemInput['classification'])
                  }
                >
                  <option>Hardware</option>
                  <option>Software</option>
                  <option>Both</option>
                </select>
              </Field>
            </div>
            <Field label="Product or device" required>
              <input
                data-testid="problem-product-input"
                value={form.product}
                onChange={(e) => update('product', e.target.value)}
                required
                minLength={2}
                maxLength={300}
                placeholder="e.g. Windows 11, Firefox, or TP-Link Archer AX55"
              />
            </Field>
            <Field
              label="Your setup and versions"
              hint="Device model, operating system, application version, and relevant environment."
            >
              <textarea
                data-testid="problem-setup-input"
                value={form.setup}
                onChange={(e) => update('setup', e.target.value)}
                maxLength={2000}
                rows={3}
                placeholder="e.g. ThinkPad T14, Windows 11 24H2, Intel Wi-Fi driver 23.90"
              />
            </Field>
            {!problem && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={form.affected}
                  onChange={(e) => update('affected', e.target.checked)}
                />
                <span>
                  I experience this problem on the setup above.
                  <small>This records your affected confirmation separately from an upvote.</small>
                </span>
              </label>
            )}
            <Field label="Tags" hint="Up to 8 short tags, separated by commas.">
              <input
                value={tags}
                onChange={(e) => {
                  setTags(e.target.value);
                  update(
                    'tags',
                    e.target.value
                      .split(',')
                      .map((tag) => tag.trim())
                      .filter(Boolean),
                  );
                }}
                placeholder="wifi, sleep-mode, windows-11"
              />
            </Field>
          </section>
          <section className="form-section">
            <div className="form-section-title">
              <span>03</span>
              <div>
                <h2>Help others investigate</h2>
                <p>Make the next person’s first test a little easier.</p>
              </div>
            </div>
            <Field label="Steps to reproduce">
              <textarea
                value={form.steps}
                onChange={(e) => update('steps', e.target.value)}
                maxLength={12000}
                rows={4}
                placeholder={'1. Open…\n2. Connect…\n3. Notice…'}
              />
            </Field>
            <Field label="Fixes you have already tried">
              <textarea
                value={form.attemptedFixes}
                onChange={(e) => update('attemptedFixes', e.target.value)}
                maxLength={12000}
                rows={3}
                placeholder="Include the result, even when it did not work."
              />
            </Field>
            <ImagesInput
              files={files}
              setFiles={setFiles}
              existing={problem?.attachments.length || 0}
            />
          </section>
          {error && (
            <div className="form-error" role="alert">
              <strong>Your report hasn’t been saved.</strong>
              <p>{error}</p>
              <small>Your draft is still in this browser tab.</small>
            </div>
          )}
          <div className="contribution-footer">
            <span>
              <Save size={16} />
              Draft retained in this tab
            </span>
            <div>
              <Link className="button secondary" to={problem ? `/problems/${problem.id}` : '/'}>
                Cancel
              </Link>
              <button
                data-testid="report-submit"
                className="button"
                disabled={busy || profile?.restricted}
              >
                {busy
                  ? 'Saving your report…'
                  : problem
                    ? 'Save changes'
                    : profile
                      ? 'Publish problem'
                      : 'Sign in to publish'}
                <ArrowRight size={17} />
              </button>
            </div>
          </div>
        </form>
        <aside className="form-aside">
          <section className="rail-card">
            <span className="rail-icon">
              <FileText size={23} />
            </span>
            <h2>A good report is specific.</h2>
            <ul className="checklist">
              <li>
                <CheckCircle2 size={17} />
                One problem per report
              </li>
              <li>
                <CheckCircle2 size={17} />
                Exact products and versions
              </li>
              <li>
                <CheckCircle2 size={17} />
                Reproducible steps, when possible
              </li>
              <li>
                <CheckCircle2 size={17} />
                What you have already tried
              </li>
            </ul>
          </section>
          <div className="rail-note">
            <ShieldCheck size={23} />
            <p>
              Remove private information from screenshots. Never share passwords, access tokens, or
              personal identifiers.
            </p>
          </div>
          {problem && (
            <div className="warning-box">
              Edits update the report details. A moderator manages the problem’s lifecycle and
              verification.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
export function SolutionFormPage() {
  const { id, solutionId } = useParams();
  const result = useLoad(async () => {
    const solution = solutionId ? await api<Solution>(`/solutions/${solutionId}`) : undefined;
    const detail = await api<ProblemDetail>(`/problems/${solution?.problemId || id}`);
    return { solution, problem: detail.problem };
  }, [id, solutionId]);
  const { profile } = useSession();
  if (result.loading) return <Loading label="Preparing your solution…" />;
  if (result.error) return <ErrorState error={result.error} retry={result.reload} />;
  if (!result.data) return null;
  if (result.data.solution && result.data.solution.authorId !== profile?.id)
    return (
      <div className="empty-state">
        <h1>Only the author can revise this solution</h1>
        <Link className="button secondary" to={`/problems/${result.data.problem.id}`}>
          Back to problem
        </Link>
      </div>
    );
  return <SolutionForm key={solutionId || id} {...result.data} />;
}
function SolutionForm({ solution, problem }: { solution?: Solution; problem: Problem }) {
  const { requireUser, notice, profile } = useSession();
  const navigate = useNavigate();
  const revision = solution?.currentRevision;
  const [form, setForm, clearDraft] = useDraft(
    `tracker.solution.${solution?.id || problem.id}`,
    revision
      ? {
          title: revision.title,
          instructions: revision.instructions,
          reasoning: revision.reasoning,
          supportedSetup: revision.supportedSetup,
          limitations: revision.limitations,
          warnings: revision.warnings,
        }
      : solutionDefaults,
  );
  const [files, setFiles] = useState<File[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const update = (key: keyof SolutionInput, value: string) =>
    setForm((previous) => ({ ...previous, [key]: value }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!requireUser()) return;
    setError('');
    const parsed = solutionInputSchema.safeParse(form);
    if (!parsed.success) {
      setError(
        parsed.error.issues.map((issue) => `${issue.path.join(' ')}: ${issue.message}`).join(' '),
      );
      return;
    }
    setBusy(true);
    try {
      const saved = await api<Solution>(
        solution ? `/solutions/${solution.id}` : `/problems/${problem.id}/solutions`,
        { method: solution ? 'PATCH' : 'POST', body: json(parsed.data) },
      );
      clearDraft();
      let failed = false;
      try {
        await uploadImages(files, 'solution', saved.id);
      } catch (err) {
        failed = true;
        notice(
          `The solution was saved, but an image could not upload: ${(err as Error).message} Add it from the solution card.`,
          'error',
        );
      }
      if (!failed)
        notice(
          solution
            ? 'A new revision is ready for community testing and fresh verification.'
            : 'Your proposed fix is ready for community testing.',
        );
      navigate(`/problems/${problem.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="form-page">
      <Breadcrumb current={solution ? 'Revise solution' : 'Propose a fix'} problem={problem} />
      <div className="form-page-heading">
        <span className="eyebrow">TURN AN IDEA INTO TESTABLE STEPS</span>
        <h1>{solution ? 'Improve the next revision.' : 'Share a path to a fix.'}</h1>
        <p>For: {problem.title}</p>
      </div>
      <div className="form-layout">
        <form className="contribution-form" onSubmit={submit}>
          {solution && (
            <div className="warning-box">
              Material edits create a new revision. Existing tests and verification stay attached to
              revision {revision?.number}; the new revision needs fresh evidence.
            </div>
          )}
          <section className="form-section">
            <div className="form-section-title">
              <span>01</span>
              <div>
                <h2>The proposed fix</h2>
                <p>Give someone enough detail to test it independently.</p>
              </div>
            </div>
            <Field label="Solution title" required>
              <input
                data-testid="solution-title-input"
                value={form.title}
                onChange={(e) => update('title', e.target.value)}
                required
                minLength={5}
                maxLength={180}
                placeholder="e.g. Disable power saving for the wireless adapter"
              />
            </Field>
            <Field label="Step-by-step instructions" required>
              <textarea
                data-testid="solution-instructions-input"
                value={form.instructions}
                onChange={(e) => update('instructions', e.target.value)}
                required
                minLength={20}
                maxLength={12000}
                rows={7}
                placeholder={'1. Before you begin…\n2. Open…\n3. Change…\n4. Check the result…'}
              />
            </Field>
            <Field label="Why this may work">
              <textarea
                value={form.reasoning}
                onChange={(e) => update('reasoning', e.target.value)}
                maxLength={12000}
                rows={4}
                placeholder="Explain the reasoning and any evidence behind these steps."
              />
            </Field>
          </section>
          <section className="form-section">
            <div className="form-section-title">
              <span>02</span>
              <div>
                <h2>Scope and limitations</h2>
                <p>A fix is only useful when people know where it applies.</p>
              </div>
            </div>
            <Field label="Supported setups and versions" required>
              <textarea
                data-testid="solution-supported-input"
                value={form.supportedSetup}
                onChange={(e) => update('supportedSetup', e.target.value)}
                minLength={3}
                maxLength={2000}
                rows={3}
                required
                placeholder="Which devices, operating systems, and product versions have you tested?"
              />
            </Field>
            <Field label="Limitations">
              <textarea
                value={form.limitations}
                onChange={(e) => update('limitations', e.target.value)}
                maxLength={12000}
                rows={3}
                placeholder="Where does it not apply? Is this a workaround rather than a complete fix?"
              />
            </Field>
            <Field label="Warnings and prerequisites">
              <textarea
                value={form.warnings}
                onChange={(e) => update('warnings', e.target.value)}
                maxLength={12000}
                rows={3}
                placeholder="Backups, data loss risks, permissions, or changes people should understand."
              />
            </Field>
            <ImagesInput
              files={files}
              setFiles={setFiles}
              existing={solution?.attachments.length || 0}
            />
          </section>
          {error && (
            <div className="form-error" role="alert">
              <strong>Your solution hasn’t been saved.</strong>
              <p>{error}</p>
              <small>Your draft remains in this browser tab.</small>
            </div>
          )}
          <div className="contribution-footer">
            <span>
              <Save size={16} />
              Draft retained in this tab
            </span>
            <div>
              <Link className="button secondary" to={`/problems/${problem.id}`}>
                Cancel
              </Link>
              <button
                data-testid="solution-submit"
                className="button"
                disabled={busy || profile?.restricted}
              >
                {busy ? 'Saving…' : solution ? 'Publish revision' : 'Publish proposed fix'}
                <ArrowRight size={17} />
              </button>
            </div>
          </div>
        </form>
        <aside className="form-aside">
          <section className="rail-card">
            <span className="rail-icon">
              <ShieldCheck size={23} />
            </span>
            <h2>Evidence earns trust.</h2>
            <p>
              Your solution starts as a proposal. The community tests it, then a moderator reviews
              its evidence and supported scope.
            </p>
            <ul className="checklist">
              <li>
                <CheckCircle2 size={17} />
                Clear, repeatable instructions
              </li>
              <li>
                <CheckCircle2 size={17} />
                Specific supported setups
              </li>
              <li>
                <CheckCircle2 size={17} />
                Honest risks and limitations
              </li>
            </ul>
          </section>
          <div className="rail-note">
            <Info size={22} />
            <p>
              Success percentages are calculated for each revision. “Not applicable” tests are
              excluded; partial outcomes remain visible.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
