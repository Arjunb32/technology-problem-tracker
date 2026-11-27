import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { X, Github, CircleUserRound, CheckCircle2, AlertCircle } from 'lucide-react';
import type { AppConfig, Profile } from '@tracker/contracts';
import { command, supabase, ApiFailure } from './api';
import { oauthOptions, sessionRole } from './browser';
import { useModalAccessibility } from './modal';

type Notice = { message: string; type: 'success' | 'error' | 'info' };
type SessionContext = {
  config: AppConfig | null;
  profile: Profile | null;
  loading: boolean;
  requireUser: () => boolean;
  notice: (message: string, type?: Notice['type']) => void;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
  openLogin: () => void;
};
const Session = createContext<SessionContext>(null!);
export const useSession = () => useContext(Session);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [login, setLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [toast, setToast] = useState<Notice | null>(null);
  useModalAccessibility(login, () => setLogin(false));
  const notice = useCallback(
    (message: string, type: Notice['type'] = 'success') => setToast({ message, type }),
    [],
  );
  const refreshProfile = useCallback(async () => {
    if (
      !localStorage.getItem('tracker.demoToken') &&
      (!supabase || !(await supabase.auth.getSession()).data.session)
    ) {
      setProfile(null);
      return;
    }
    try {
      setProfile(await command<Profile>('me'));
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 401) {
        localStorage.removeItem('tracker.demoToken');
        if (supabase) await supabase.auth.signOut({ scope: 'local' });
        setProfile(null);
      } else throw error;
    }
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await command<AppConfig>('config');
      setConfig(result);
      await refreshProfile();
    } catch (error) {
      notice(error instanceof Error ? error.message : 'Unable to load the platform.', 'error');
    } finally {
      setLoading(false);
    }
  }, [refreshProfile, notice]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const listener = supabase?.auth.onAuthStateChange((_event, session) => {
      if (!session && !localStorage.getItem('tracker.demoToken')) {
        setProfile(null);
        return;
      }
      queueMicrotask(() => {
        void refreshProfile().catch((error) => notice(error.message, 'error'));
      });
    });
    return () => listener?.data.subscription.unsubscribe();
  }, [refreshProfile, notice]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.type === 'error' ? 10000 : 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('error_description')) notice(params.get('error_description')!, 'error');
  }, [notice]);
  async function demoLogin(userId: string) {
    setBusy(true);
    setLoginError('');
    try {
      const result = await command<{ token: string; profile: Profile }>('demo', undefined, userId);
      localStorage.setItem('tracker.demoToken', result.token);
      setProfile(result.profile);
      setLogin(false);
      notice(`Signed in as ${result.profile.displayName} in the demonstration.`);
      window.dispatchEvent(new Event('tracker:session'));
    } catch (error) {
      setLoginError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function oauth(provider: 'google' | 'github' | 'azure') {
    if (!supabase) {
      setLoginError('Sign-in is not configured yet. Use a demonstration account in local mode.');
      return;
    }
    setBusy(true);
    setLoginError('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: oauthOptions(window.location.origin, provider),
    });
    if (error) {
      setLoginError(error.message);
      setBusy(false);
    }
  }
  const requireUser = () => {
    const role = sessionRole(profile);
    if (role === 'guest') {
      setLogin(true);
      return false;
    }
    if (role === 'restricted') {
      notice(
        'Your account is restricted from contributing. Contact a moderator for help.',
        'error',
      );
      return false;
    }
    return true;
  };
  async function signOut() {
    try {
      if (supabase) {
        const { error } = await supabase.auth.signOut({ scope: 'local' });
        if (error) throw error;
      }
      localStorage.removeItem('tracker.demoToken');
      setProfile(null);
      notice('You have signed out.', 'info');
      window.dispatchEvent(new Event('tracker:session'));
    } catch (error) {
      notice((error as Error).message, 'error');
    }
  }
  return (
    <Session.Provider
      value={{
        config,
        profile,
        loading,
        requireUser,
        notice,
        refreshProfile,
        signOut,
        openLogin: () => setLogin(true),
      }}
    >
      {children}
      {!config && !loading && (
        <div className="connection-banner" role="alert">
          The server is unavailable. <button onClick={() => void load()}>Try again</button>
        </div>
      )}
      {toast && (
        <div
          className={`toast toast-${toast.type}`}
          role={toast.type === 'error' ? 'alert' : 'status'}
        >
          {toast.type === 'error' ? <AlertCircle size={20} /> : <CheckCircle2 size={20} />}
          <span>{toast.message}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            <X size={17} />
          </button>
        </div>
      )}
      {login && (
        <div className="modal-backdrop" onClick={() => setLogin(false)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="login-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="icon-button modal-close"
              aria-label="Close sign-in"
              onClick={() => setLogin(false)}
            >
              <X />
            </button>
            <div className="modal-symbol">
              <CircleUserRound size={30} />
            </div>
            <h2 id="login-title">A better fix starts with you.</h2>
            <p>Sign in to confirm problems, share what you know, and test a solution.</p>
            <div className="oauth-buttons">
              {(['google', 'github', 'azure'] as const).map((provider) => (
                <button
                  className="button secondary"
                  disabled={busy || config?.demo || !config?.configuredAuth || !supabase}
                  key={provider}
                  onClick={() => void oauth(provider)}
                >
                  {provider === 'github' ? (
                    <Github size={18} />
                  ) : (
                    <span className="provider-mark">{provider === 'google' ? 'G' : '▦'}</span>
                  )}
                  Continue with{' '}
                  {provider === 'azure' ? 'Microsoft' : provider === 'google' ? 'Google' : 'GitHub'}
                </button>
              ))}
            </div>
            {config?.demo && (
              <div className="demo-accounts">
                <span className="eyebrow">LOCAL DEMONSTRATION</span>
                <p>These sample accounts use local data. They are not real community members.</p>
                {config.demoAccounts.map((account) => (
                  <button
                    key={account.id}
                    data-testid={`demo-account-${account.id}`}
                    className="demo-account"
                    disabled={busy}
                    onClick={() => void demoLogin(account.id)}
                  >
                    <span className="avatar">{initials(account.displayName)}</span>
                    <span>
                      <strong>{account.displayName}</strong>
                      <small>
                        {account.role === 'member'
                          ? 'Community member'
                          : 'Moderator · review and verify fixes'}
                      </small>
                    </span>
                    <span className="text-link">Use account</span>
                  </button>
                ))}
              </div>
            )}
            {(config?.demo || !config?.configuredAuth || !supabase) && (
              <p className="fine-print">
                {config?.demo
                  ? 'Real provider sign-in is disabled in this local demonstration. Use a clearly labelled sample account above.'
                  : 'Sign-in is awaiting provider configuration. Public browsing is available.'}
              </p>
            )}
            {loginError && (
              <p className="inline-error" role="alert">
                {loginError}
              </p>
            )}
            <p className="fine-print">
              By participating, you agree to the community rules. Respect people, protect personal
              information, and support your claims with evidence.
            </p>
          </section>
        </div>
      )}
    </Session.Provider>
  );
}
export function initials(value: string) {
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}
