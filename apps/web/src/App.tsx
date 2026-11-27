import { Component, useEffect, type ReactNode } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  Bell,
  Bookmark,
  CircleHelp,
  Compass,
  Github,
  LogOut,
  Menu,
  Plus,
  ShieldCheck,
  Users,
  X,
  Monitor,
  CheckCircle2,
} from 'lucide-react';
import { SessionProvider, useSession } from './context';
import { Avatar, Loading } from './ui';
import { supabase } from './api';
import { screenRoutes, sessionRole } from './browser';
import FeedPage from './pages/Feed';
import ProblemPage from './pages/Problem';
import { ProblemFormPage, SolutionFormPage } from './pages/Forms';
import { ProfilePage, NotificationsPage, FollowingPage, SettingsPage } from './pages/Account';
import ModerationPage from './pages/Moderation';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <div className="fatal-error">
        <h1>The page needs a fresh start</h1>
        <p>Your saved drafts are still available in this browser tab.</p>
        <button className="button" onClick={() => window.location.reload()}>
          Reload the page
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
function Layout() {
  const { config, profile, openLogin, signOut, requireUser } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.title = 'Technology Problem Tracker — Solve it together';
  }, [location.pathname]);
  const moderator = sessionRole(profile) === 'moderator';
  const report = () => {
    if (requireUser()) navigate('/report');
  };
  const screens = {
    feed: <FeedPage />,
    problem: <ProblemPage />,
    report: <ProblemFormPage />,
    solution: <SolutionFormPage />,
    profile: <ProfilePage />,
    following: <FollowingPage />,
    notifications: <NotificationsPage />,
    settings: <SettingsPage />,
    moderation: <ModerationPage />,
    auth: <AuthCallback />,
    rules: <PolicyPage kind="rules" />,
    privacy: <PolicyPage kind="privacy" />,
  };
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link className="brand" to="/" aria-label="Technology Problem Tracker home">
          <span className="brand-symbol">
            T<span />
          </span>
          <span>
            Technology
            <br />
            <strong>Problem Tracker</strong>
          </span>
        </Link>
        <div className="workspace-tag">
          <span className="green-dot" />
          Community workspace <span className="beta-pill">BETA</span>
        </div>
        <span className="nav-label">DISCOVER</span>
        <nav className="primary-nav" aria-label="Main navigation">
          <NavLink to="/" end>
            <Compass size={20} />
            Community<span className="nav-arrow">→</span>
          </NavLink>
          <NavLink to="/following">
            <Bookmark size={20} />
            Following
          </NavLink>
          <NavLink to="/notifications">
            <Bell size={20} />
            Notifications
          </NavLink>
          {profile && (
            <NavLink to={`/profiles/${profile.id}`}>
              <Users size={20} />
              My contributions
            </NavLink>
          )}
          {moderator && (
            <NavLink to="/moderation">
              <ShieldCheck size={20} />
              Moderation
            </NavLink>
          )}
        </nav>
        <div className="sidebar-rule" />
        <span className="nav-label">EXPLORE CATEGORIES</span>
        <nav className="category-nav" aria-label="Categories">
          <Link to="/?category=Computers">
            <span className="category-icon purple">
              <Monitor size={16} />
            </span>
            Computers
          </Link>
          <Link to="/?category=Software">
            <span className="category-icon blue">{'</>'}</span>Software
          </Link>
          <Link to="/?category=Networking">
            <span className="category-icon teal">⌘</span>Networking
          </Link>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-prompt">
            <div className="prompt-icon">
              <CircleHelp size={23} />
            </div>
            <strong>Something not working?</strong>
            <p>There’s a good chance you’re not the only one.</p>
            <button className="sidebar-report" data-testid="report-button" onClick={report}>
              Report a problem
              <Plus size={16} />
            </button>
          </div>
          <Link className="sidebar-help" to="/rules">
            <CircleHelp size={17} />
            Community guidelines
            <ArrowUpRight size={15} />
          </Link>
          {profile ? (
            <div className="sidebar-account">
              <Link to="/settings">
                <Avatar profile={profile} />
                <span>
                  <strong>{profile.displayName}</strong>
                  <small>
                    {profile.role === 'member' ? 'Community member' : 'Community moderator'}
                  </small>
                </span>
              </Link>
              <button
                className="icon-button"
                title="Sign out"
                aria-label="Sign out"
                onClick={() => void signOut()}
              >
                <LogOut size={18} />
              </button>
            </div>
          ) : (
            <button className="sidebar-signin" data-testid="login-button" onClick={openLogin}>
              Sign in to contribute
              <ArrowUpRight size={17} />
            </button>
          )}
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <Link className="mobile-brand" to="/">
            <span className="brand-symbol">
              T<span />
            </span>
            <strong>Problem Tracker</strong>
          </Link>
          <div className="topbar-path">
            <span>Community</span>
            <span>/</span>
            <strong>
              {location.pathname === '/'
                ? 'Discover'
                : location.pathname.includes('moderation')
                  ? 'Moderation'
                  : location.pathname.includes('report')
                    ? 'Report a problem'
                    : location.pathname.includes('notifications')
                      ? 'Notifications'
                      : 'Workspace'}
            </strong>
          </div>
          <div className="topbar-actions">
            <span className="beta-label">{config?.demo ? 'BETA PREVIEW' : 'PUBLIC BETA'}</span>
            {config?.demo && <span className="demo-badge">Demo workspace</span>}
            {!profile && (
              <button className="button secondary small topbar-login" onClick={openLogin}>
                Sign in
              </button>
            )}
            <button className="button small" onClick={report}>
              <Plus size={17} />
              <span>Report problem</span>
            </button>
          </div>
        </header>
        <nav className="mobile-nav" aria-label="Mobile navigation">
          <NavLink to="/" end>
            <Compass size={18} />
            Discover
          </NavLink>
          <NavLink to="/following">
            <Bookmark size={18} />
            Following
          </NavLink>
          <NavLink to="/notifications">
            <Bell size={18} />
            Updates
          </NavLink>
          {moderator && (
            <NavLink to="/moderation">
              <ShieldCheck size={18} />
              Review
            </NavLink>
          )}
          {profile ? (
            <button onClick={() => void signOut()}>
              <LogOut size={18} />
              Sign out
            </button>
          ) : (
            <button onClick={openLogin}>Sign in</button>
          )}
        </nav>
        {config?.demo && (
          <div className="demo-banner">
            <span className="demo-banner-dot" />
            <strong>You’re exploring a local demonstration.</strong>
            <span>
              Sample issues, accounts, and counts are labelled. Your changes persist locally.
            </span>
          </div>
        )}
        {profile?.restricted && (
          <div className="restriction-banner">
            Your account is restricted. You can browse, but contributing is disabled.
          </div>
        )}
        <main id="main-content">
          <Routes>
            {screenRoutes().map(([path, screen]) => (
              <Route key={path} path={path} element={screens[screen]} />
            ))}
            <Route
              path="*"
              element={
                <div className="empty-state">
                  <h1>This page could not be found</h1>
                  <Link className="button" to="/">
                    Explore the community
                  </Link>
                </div>
              }
            />
          </Routes>
        </main>
        <footer className="site-footer">
          <span>
            Technology Problem Tracker<span className="footer-dot">·</span>Built around better
            answers.
          </span>
          <div>
            <Link to="/rules">Community rules</Link>
            <Link to="/privacy">Privacy</Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
function AuthCallback() {
  const { refreshProfile, notice } = useSession();
  const navigate = useNavigate();
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        if (params.get('error'))
          throw new Error(params.get('error_description') || 'Sign-in was cancelled.');
        if (!supabase) throw new Error('Sign-in is not configured.');
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!data.session) {
          const code = params.get('code');
          if (code) {
            const exchanged = await supabase.auth.exchangeCodeForSession(code);
            if (exchanged.error) throw exchanged.error;
          } else throw new Error('Your sign-in session could not be completed. Please try again.');
        }
        await refreshProfile();
        if (active) {
          notice('You’re signed in. Welcome to the community.');
          navigate('/');
        }
      } catch (error) {
        if (active) {
          notice((error as Error).message, 'error');
          navigate('/');
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [navigate, refreshProfile, notice]);
  return <Loading label="Completing your sign-in…" />;
}
function PolicyPage({ kind }: { kind: 'rules' | 'privacy' }) {
  const sections =
    kind === 'rules'
      ? [
          [
            'Report a concrete issue',
            'Include the product, relevant device and software versions, symptoms, reproduction steps, and what you already tried. Search for a matching issue before posting.',
          ],
          [
            'Confirm your own experience',
            'Mark a problem as affecting you only when it occurs on your setup. Use an upvote to express priority. Do not create extra accounts to inflate either count.',
          ],
          [
            'Describe the scope of a fix',
            'Include instructions, supported setups, limitations, and risks such as data loss or a reset. Say when a fix is only a workaround.',
          ],
          [
            'Test honestly',
            'Record the result for the revision you actually tried and explain your setup. “Not applicable” is appropriate when the instructions do not fit your device or version.',
          ],
          [
            'Protect private information',
            'Remove passwords, access keys, personal addresses, account details, and confidential material from screenshots and descriptions. Share only material you are entitled to post.',
          ],
          [
            'Treat people respectfully',
            'No harassment, hate, threats, impersonation, spam, deceptive links, or unrelated promotion. Discuss the technical evidence rather than attacking contributors.',
          ],
          [
            'Avoid harmful instructions',
            'Do not post malware, credential theft instructions, destructive commands without a legitimate troubleshooting context, or instructions to exploit another person’s systems.',
          ],
          [
            'Use reporting and moderation',
            'Report content that breaks these rules. Moderators may request information, hide content, restrict accounts, merge duplicates, or change status with a recorded reason. A moderator badge or verified fix does not guarantee that a procedure is safe or compatible with every setup.',
          ],
          [
            'Before you test',
            'Read the warnings and preserve data you cannot afford to lose. Follow your device or software provider’s guidance when it conflicts with a community suggestion.',
          ],
          [
            'Moderation during the beta',
            'The launch owner handles moderation during the beta. An appeal/contact route and response expectations must be published before public release.',
          ],
        ]
      : [
          [
            'What is public',
            'Problems, symptoms, product names, device and software setups, screenshots attached to public contributions, comments, solutions, test results, and public display names can be viewed by other people. Public contributions may be copied or shared by readers. Never include passwords, access tokens, personal addresses, or confidential logs.',
          ],
          [
            'Account information',
            'For real sign-in, Google, GitHub, or Microsoft authenticates you through Supabase Auth. The platform uses a provider-linked account identifier and profile information to identify contributions and enforce permissions. Supabase may hold your email address and authentication records; the community feed does not expose email addresses. The platform does not collect your provider password.',
          ],
          [
            'Participation and moderation',
            'Affected confirmations, votes, follows, test results, and contributions are stored to support the problem workflow. In-app notifications belong to your account. Content reports, account restrictions, and internal moderation notes are available to authorized moderators. Status history and a moderation explanation relevant to a public problem may appear publicly.',
          ],
          [
            'Browser storage',
            'Your browser stores sign-in session information and unsent drafts. Drafts stay in this browser tab’s session storage. On a shared device, sign out and clear drafts or browser storage before handing it to someone else. In the local demonstration, a sample-account token is stored locally and sample records persist on the development computer.',
          ],
          [
            'Services',
            'The planned deployed website and API use Cloudflare. Supabase provides the database, authentication, and image storage. These services may process network and operational information such as IP addresses and request logs under their own terms. The deployment region and provider privacy information must be included in the final launch notice.',
          ],
          [
            'Backups and tracking',
            'The owner’s recovery process uses protected database and image backups outside the hosting project. These can contain public contributions and private account or moderation records and must be kept with restricted access. Backup storage and schedules must be configured by the owner before launch. This beta does not include advertising, payments, an added analytics tracking service, or AI processing of contributions.',
          ],
          [
            'Corrections, removal, and retention',
            'You can edit supported contributions and participation within the website. Account removal, removal of accidentally shared private information, and review of moderation actions require the owner’s published support contact. Hiding content does not immediately remove it from recovery backups or internal moderation history. Self-service account deletion is not yet available.',
          ],
          [
            'Required before public launch',
            'The owner must publish a real support contact, deployment region, retention periods for logs and backups, and a process for account removal and appeals. Those choices are launch requirements; this notice does not claim they have already been configured.',
          ],
        ];
  return (
    <article className="policy-page">
      <span className="eyebrow">COMMUNITY TRUST</span>
      <h1>
        {kind === 'rules'
          ? 'Make this a place for better answers.'
          : 'Your information, handled with care.'}
      </h1>
      <p className="policy-intro">
        {kind === 'rules'
          ? 'Useful problems and trustworthy fixes start with respectful, evidence-led collaboration.'
          : 'This notice describes the planned public beta. The local demonstration uses sample records and demo accounts on the computer running it. Public hosting and real sign-in require the owner’s configuration and release review.'}
      </p>
      {sections.map(([title, content]) => (
        <section key={title}>
          <h2>{title}</h2>
          <p>{content}</p>
        </section>
      ))}
      <div className="policy-note">
        <CheckCircle2 size={20} />
        <p>Moderation decisions are recorded so the community can follow how a problem evolves.</p>
      </div>
    </article>
  );
}
export default function App() {
  return (
    <ErrorBoundary>
      <SessionProvider>
        <Layout />
      </SessionProvider>
    </ErrorBoundary>
  );
}
