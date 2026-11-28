import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowRight,
  Bell,
  Bookmark,
  Check,
  CheckCircle2,
  Github,
  Link2,
  Save,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import {
  type Profile,
  type PublicProfile,
  type Problem,
  type Solution,
  type Notification,
} from '@tracker/contracts';
import { command, supabase } from '../api';
import { oauthOptions, profileSubmission, splitTags } from '../browser';
import { useSession } from '../context';
import {
  Avatar,
  Empty,
  ErrorState,
  Field,
  Loading,
  PageHeading,
  PlainText,
  ProblemCard,
  ReportButton,
  shortDate,
  useDraft,
  useLoad,
} from '../ui';

export function AuthPrompt({ title, description }: { title: string; description: string }) {
  const { openLogin } = useSession();
  return (
    <div className="auth-prompt">
      <span className="modal-symbol">
        <Bookmark size={29} />
      </span>
      <h1>{title}</h1>
      <p>{description}</p>
      <button className="button" onClick={openLogin}>
        Sign in to continue
        <ArrowRight size={17} />
      </button>
    </div>
  );
}
export function FollowingPage() {
  const { profile, loading } = useSession();
  const result = useLoad(
    () => (profile ? command<Problem[]>('following') : Promise.resolve([])),
    [profile?.id],
  );
  if (loading) return <Loading />;
  if (!profile)
    return (
      <AuthPrompt
        title="Keep an eye on the problems that matter."
        description="Follow an issue to find it here and receive updates when the investigation moves forward."
      />
    );
  return (
    <div className="standard-page">
      <PageHeading
        eyebrow="YOUR WORKSPACE"
        title="Following"
        description="The problems you’re keeping an eye on, all in one place."
      />
      {result.loading ? (
        <Loading />
      ) : result.error ? (
        <ErrorState error={result.error} retry={result.reload} />
      ) : result.data?.length ? (
        <div className="problem-feed">
          {result.data.map((problem) => (
            <ProblemCard key={problem.id} problem={problem} />
          ))}
        </div>
      ) : (
        <Empty title="No followed problems yet">
          <p>Open a problem and choose Follow to keep it in your workspace.</p>
          <Link className="button secondary" to="/">
            Explore problems
          </Link>
        </Empty>
      )}
    </div>
  );
}
export function NotificationsPage() {
  const { profile, loading, notice } = useSession();
  const result = useLoad(
    () => (profile ? command<Notification[]>('notifications') : Promise.resolve([])),
    [profile?.id],
  );
  const [busy, setBusy] = useState('');
  async function mark(item: Notification) {
    setBusy(item.id);
    try {
      await command('markNotification', item.id);
      result.setData(
        (value) =>
          value?.map((notification) =>
            notification.id === item.id ? { ...notification, read: true } : notification,
          ) || null,
      );
    } catch (error) {
      notice((error as Error).message, 'error');
    } finally {
      setBusy('');
    }
  }
  if (loading) return <Loading />;
  if (!profile)
    return (
      <AuthPrompt
        title="Stay close to the next breakthrough."
        description="Sign in to receive in-app updates on problems you report and follow."
      />
    );
  return (
    <div className="standard-page">
      <PageHeading
        eyebrow="YOUR WORKSPACE"
        title="Notifications"
        description="Important changes to the problems you’re part of."
      />
      {result.loading ? (
        <Loading />
      ) : result.error ? (
        <ErrorState error={result.error} retry={result.reload} />
      ) : result.data?.length ? (
        <div className="notification-list">
          {result.data.map((item) => (
            <article key={item.id} className={`notification-card ${item.read ? '' : 'unread'}`}>
              <span className="notification-icon">
                <Bell size={20} />
              </span>
              <div>
                <h2>
                  {item.title}
                  {!item.read && <span className="unread-dot" aria-label="Unread" />}
                </h2>
                <p>{item.body}</p>
                <div className="notification-meta">
                  <span>{shortDate(item.createdAt)}</span>
                  {item.problemId && (
                    <Link
                      to={`/problems/${item.problemId}`}
                      onClick={() => {
                        if (!item.read) void mark(item);
                      }}
                    >
                      Open problem
                      <ArrowRight size={14} />
                    </Link>
                  )}
                </div>
              </div>
              {!item.read && (
                <button
                  className="button secondary small"
                  disabled={busy === item.id}
                  onClick={() => void mark(item)}
                >
                  <Check size={15} />
                  Mark read
                </button>
              )}
            </article>
          ))}
        </div>
      ) : (
        <Empty title="You’re all caught up">
          <p>Updates to followed problems, solutions, and moderation requests will appear here.</p>
        </Empty>
      )}
    </div>
  );
}
export function ProfilePage() {
  const { id } = useParams();
  const { profile: viewer } = useSession();
  const result = useLoad(
    () =>
      command<{ profile: PublicProfile; problems: Problem[]; solutions: Solution[] }>(
        'profile',
        id,
      ),
    [id],
  );
  const [tab, setTab] = useState('problems');
  if (result.loading) return <Loading label="Loading this community member…" />;
  if (result.error) return <ErrorState error={result.error} retry={result.reload} />;
  if (!result.data) return null;
  const { profile, problems, solutions } = result.data;
  return (
    <div className="standard-page profile-page">
      <section className="profile-header">
        <Avatar profile={profile} size="large" />
        <div>
          <span className="eyebrow">COMMUNITY MEMBER</span>
          <h1>{profile.displayName}</h1>
          <span className="profile-username">@{profile.username}</span>
          {profile.role !== 'member' && (
            <span className="role-badge">
              <ShieldCheck size={14} />
              {profile.role === 'admin' ? 'Administrator' : 'Moderator'}
            </span>
          )}
          <p>
            {profile.bio ||
              'Here to investigate technology problems and help build better answers.'}
          </p>
          <div className="expertise-tags">
            {profile.expertise.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
          <small>Joined {shortDate(profile.createdAt)}</small>
        </div>
        {viewer?.id === profile.id ? (
          <Link className="button secondary small" to="/settings">
            <Settings size={16} />
            Edit profile
          </Link>
        ) : (
          <ReportButton targetType="profile" targetId={profile.id} />
        )}
      </section>
      <div className="profile-stats">
        <span>
          <strong>{problems.length}</strong>Problems reported
        </span>
        <span>
          <strong>{solutions.length}</strong>Fixes proposed
        </span>
        <span>
          <strong>
            {
              solutions.filter(
                (solution) => solution.currentRevision.verification?.decision === 'verified',
              ).length
            }
          </strong>
          Verified current fixes
        </span>
      </div>
      <div className="detail-tabs" role="tablist" aria-label="Profile contributions">
        <button
          role="tab"
          aria-selected={tab === 'problems'}
          className={tab === 'problems' ? 'active' : ''}
          onClick={() => setTab('problems')}
        >
          Reported problems<span>{problems.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === 'solutions'}
          className={tab === 'solutions' ? 'active' : ''}
          onClick={() => setTab('solutions')}
        >
          Proposed fixes<span>{solutions.length}</span>
        </button>
      </div>
      {tab === 'problems' ? (
        problems.length ? (
          <div className="problem-feed">
            {problems.map((problem) => (
              <ProblemCard key={problem.id} problem={problem} />
            ))}
          </div>
        ) : (
          <Empty title="No reported problems yet" />
        )
      ) : solutions.length ? (
        <div className="profile-solutions">
          {solutions.map((solution) => (
            <article className="rail-card" key={solution.id}>
              <div className="solution-top">
                <span className="revision-label">Revision {solution.currentRevision.number}</span>
                {solution.currentRevision.verification?.decision === 'verified' && (
                  <span className="solution-state is-verified">
                    <CheckCircle2 size={15} />
                    Verified
                  </span>
                )}
              </div>
              <Link to={`/problems/${solution.problemId}`}>
                <h2>{solution.currentRevision.title}</h2>
              </Link>
              <p className="plain-text">{solution.currentRevision.supportedSetup}</p>
              <Link className="text-link" to={`/problems/${solution.problemId}`}>
                View solution in context
                <ArrowRight size={15} />
              </Link>
            </article>
          ))}
        </div>
      ) : (
        <Empty title="No proposed fixes yet" />
      )}
    </div>
  );
}
export function SettingsPage() {
  const { profile, loading } = useSession();
  if (loading) return <Loading />;
  if (!profile)
    return (
      <AuthPrompt
        title="Your community identity."
        description="Sign in to manage your profile and connected sign-in providers."
      />
    );
  return <ProfileSettings key={profile.id} profile={profile} />;
}
function ProfileSettings({ profile }: { profile: Profile }) {
  const { refreshProfile, notice, config } = useSession();
  const [form, setForm, clearDraft] = useDraft(`tracker.profile.${profile.id}`, {
    displayName: profile.displayName,
    username: profile.username,
    bio: profile.bio,
    expertise: profile.expertise,
  });
  const [expertise, setExpertise] = useState(form.expertise.join(', ')),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [linking, setLinking] = useState('');
  const identities = useLoad(
    async () => (supabase ? (await supabase.auth.getUser()).data.user?.identities || [] : []),
    [profile.id],
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    const parsed = profileSubmission(form, expertise);
    if (parsed.error !== undefined) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    try {
      await command('saveProfile', undefined, parsed.data);
      clearDraft();
      await refreshProfile();
      notice('Your profile is updated.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function link(provider: 'google' | 'github' | 'azure') {
    if (!supabase) return;
    setLinking(provider);
    const { error: linkError } = await supabase.auth.linkIdentity({
      provider,
      options: oauthOptions(window.location.origin, provider),
    });
    if (linkError) {
      notice(linkError.message, 'error');
      setLinking('');
    }
  }
  return (
    <div className="standard-page settings-page">
      <PageHeading
        eyebrow="YOUR WORKSPACE"
        title="Profile & sign-in"
        description="Help the community understand what you work with."
      />
      <form className="contribution-form" onSubmit={submit}>
        <section className="form-section">
          <h2>Your public profile</h2>
          <div className="field-grid">
            <Field label="Display name" required>
              <input
                value={form.displayName}
                required
                minLength={2}
                maxLength={80}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              />
            </Field>
            <Field label="Username" required hint="3–30 letters, numbers, underscores or hyphens.">
              <input
                value={form.username}
                required
                pattern="[a-zA-Z0-9_-]{3,30}"
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </Field>
          </div>
          <Field label="About you">
            <textarea
              value={form.bio}
              maxLength={600}
              rows={4}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
              placeholder="What technology do you work with?"
            />
          </Field>
          <Field label="Expertise" hint="Up to 8 areas, separated by commas.">
            <input
              value={expertise}
              onChange={(e) => {
                setExpertise(e.target.value);
                setForm({
                  ...form,
                  expertise: splitTags(e.target.value),
                });
              }}
            />
          </Field>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <button className="button" disabled={busy || profile.restricted}>
            <Save size={16} />
            {busy ? 'Saving…' : 'Save profile'}
          </button>
        </section>
      </form>
      <section className="rail-card provider-settings">
        <h2>
          <Link2 size={21} />
          Connected sign-in providers
        </h2>
        <p>
          Connect another provider only while signed in to your existing account. Never use a new
          account as a shortcut for linking identities.
        </p>
        {config?.demo && (
          <div className="warning-box">
            Provider linking is unavailable for demonstration accounts. These identities are local
            sample accounts.
          </div>
        )}
        <div className="provider-grid">
          {(['google', 'github', 'azure'] as const).map((provider) => {
            const connected = identities.data?.some((identity) => identity.provider === provider);
            return (
              <div key={provider}>
                <strong>
                  {provider === 'azure' ? 'Microsoft' : provider === 'google' ? 'Google' : 'GitHub'}
                </strong>
                <button
                  className="button secondary small"
                  disabled={
                    config?.demo || !config?.configuredAuth || !supabase || !!linking || connected
                  }
                  onClick={() => void link(provider)}
                >
                  {connected ? (
                    <>
                      <CheckCircle2 size={15} />
                      Connected
                    </>
                  ) : linking === provider ? (
                    'Connecting…'
                  ) : (
                    'Connect'
                  )}
                </button>
              </div>
            );
          })}
        </div>
        <p className="fine-print">
          Only identity sign-in is requested. Connecting GitHub does not grant repository access;
          connecting Microsoft does not grant file access. Your workspace must enable manual
          identity linking in its authentication settings.
        </p>
      </section>
    </div>
  );
}
