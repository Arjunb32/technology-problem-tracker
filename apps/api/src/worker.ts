import { createApp } from './app.js';
import { SupabaseStore } from './store.js';
import { TrackerService } from './service.js';
import { fail } from './state.js';

export interface Bindings {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ALLOWED_ORIGINS: string;
  API_PUBLIC_URL: string;
  APP_ENV: string;
}
export function productionApp(env: Bindings) {
  if (
    !env.SUPABASE_URL ||
    !env.SUPABASE_SERVICE_ROLE_KEY ||
    !env.API_PUBLIC_URL ||
    !env.ALLOWED_ORIGINS
  )
    throw new Error('Production environment is incomplete.');
  const store = new SupabaseStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const service = new TrackerService(store, env.API_PUBLIC_URL.replace(/\/$/, ''));
  const auth = {
    authenticate: async (token: string) => {
      const { data, error } = await store.client.auth.getUser(token);
      if (error || !data.user)
        fail(401, 'unauthorized', 'Your session expired. Please sign in again.');
      // Roles are owned by our database; OAuth metadata may supply display text only.
      return service.ensureProfile(
        data.user.id,
        String(
          data.user.user_metadata.full_name ?? data.user.user_metadata.name ?? 'Community member',
        ),
        data.user.user_metadata.avatar_url as string | undefined,
      );
    },
  };
  return createApp(service, auth, {
    demo: false,
    configuredAuth: true,
    origins: env.ALLOWED_ORIGINS.split(',')
      .map((x) => x.trim())
      .filter(Boolean),
    health: async () => {
      const { data, error } = await store.client.rpc('tracker_health');
      if (error || data !== true)
        fail(503, 'database_unavailable', 'Database health check failed.');
    },
  });
}
export default {
  fetch: async (request: Request, env: Bindings) => {
    try {
      return await productionApp(env).fetch(request);
    } catch {
      return Response.json(
        { error: 'unconfigured', message: 'The platform is not configured yet.' },
        { status: 503 },
      );
    }
  },
};
