import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { Profile, FeedSort } from '@tracker/contracts';
import { ApiFailure, fail } from './state.js';
import { TrackerService } from './service.js';
import { demoProfiles } from './seed.js';
import { openapi } from './openapi.js';

export interface Authenticator {
  authenticate(token: string): Promise<Profile>;
}
export interface Settings {
  demo: boolean;
  origins: string[];
  configuredAuth: boolean;
  health?: () => Promise<void>;
}
type Environment = { Variables: { actor: Profile | null; requestId: string } };
export function createApp(service: TrackerService, auth: Authenticator, settings: Settings) {
  const app = new Hono<Environment>();
  app.use('*', secureHeaders());
  app.use('*', async (c, next) => {
    c.set('requestId', crypto.randomUUID());
    c.header('X-Request-Id', c.get('requestId'));
    c.header('Cache-Control', 'no-store');
    await next();
  });
  app.use(
    '*',
    cors({
      origin: (origin) => (settings.origins.includes(origin) ? origin : undefined),
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      exposeHeaders: ['X-Request-Id'],
      maxAge: 3600,
    }),
  );
  app.use(
    '*',
    bodyLimit({
      maxSize: 600 * 1024,
      onError: (c) =>
        c.json({ error: 'payload_too_large', message: 'This request is too large.' }, 413),
    }),
  );
  app.use('/api/*', async (c, next) => {
    if (c.req.header('Content-Type')?.includes('application/json'))
      return bodyLimit({
        maxSize: 64 * 1024,
        onError: (context) =>
          context.json({ error: 'payload_too_large', message: 'This request is too large.' }, 413),
      })(c, next);
    await next();
  });
  app.use('/api/*', async (c, next) => {
    const origin = c.req.header('Origin');
    if (origin && !settings.origins.includes(origin))
      fail(403, 'origin_forbidden', 'This website is not allowed to use the API.');
    const authorization = c.req.header('Authorization');
    let actor: Profile | null = null;
    if (authorization && !['/api/v1/config', '/api/v1/openapi.json'].includes(c.req.path)) {
      if (!authorization.startsWith('Bearer '))
        fail(401, 'unauthorized', 'Use a valid sign-in session.');
      actor = await auth.authenticate(authorization.slice(7));
    }
    c.set('actor', actor);
    await next();
  });
  const actor = (c: { get: (key: 'actor') => Profile | null }) =>
    c.get('actor')?.id ?? fail(401, 'unauthorized', 'Please sign in to continue.');
  const json = async (c: { req: { json: () => Promise<unknown> } }) => {
    try {
      return await c.req.json();
    } catch {
      fail(400, 'invalid_json', 'Send a valid JSON request.');
    }
  };
  app.get('/health', async (c) => {
    if (settings.health) await settings.health();
    return c.json({ status: 'ok', mode: settings.demo ? 'local-demo' : 'production' });
  });
  app.get('/api/v1/config', (c) =>
    c.json({
      demo: settings.demo,
      configuredAuth: settings.configuredAuth,
      providers: ['google', 'github', 'azure'],
      demoAccounts: settings.demo ? demoProfiles : [],
    }),
  );
  app.get('/api/v1/openapi.json', (c) => c.json(openapi(settings.demo)));
  if (settings.demo)
    app.post('/api/v1/auth/demo', async (c) => {
      const { userId } = z
        .object({ userId: z.enum(['demo-alex', 'demo-sam', 'demo-morgan']) })
        .strict()
        .parse(await json(c));
      const profile = await service.me(userId);
      return c.json({ token: `demo:${userId}`, profile });
    });
  app.get('/api/v1/me', async (c) => c.json(await service.me(actor(c))));
  app.patch('/api/v1/me', async (c) =>
    c.json(await service.updateProfile(actor(c), await json(c))),
  );
  app.get('/api/v1/me/notifications', async (c) => c.json(await service.notifications(actor(c))));
  app.patch('/api/v1/me/notifications/:id', async (c) => {
    z.object({ read: z.literal(true) })
      .strict()
      .parse(await json(c));
    return c.json(await service.markNotification(actor(c), c.req.param('id')));
  });
  app.patch('/api/v1/notifications/:id', async (c) => {
    z.object({ read: z.literal(true) })
      .strict()
      .parse(await json(c));
    return c.json(await service.markNotification(actor(c), c.req.param('id')));
  });
  app.get('/api/v1/me/following', async (c) => c.json(await service.following(actor(c))));
  app.get('/api/v1/profiles/:id', async (c) =>
    c.json(await service.publicProfile(c.req.param('id'), c.get('actor')?.id ?? null)),
  );
  app.get('/api/v1/problems', async (c) => {
    const sort = z
      .enum(['trending', 'affected', 'unsolved', 'solved', 'new'])
      .default('trending')
      .parse(c.req.query('sort')) as FeedSort;
    const category = z
      .enum(['Computers', 'Software', 'Networking'])
      .optional()
      .parse(c.req.query('category'));
    const q = z.string().trim().max(180).optional().parse(c.req.query('q'));
    const offset = z.coerce.number().int().min(0).max(500).default(0).parse(c.req.query('offset'));
    return c.json(await service.feed(c.get('actor')?.id ?? null, sort, category, q, offset));
  });
  app.get('/api/v1/problems/:id', async (c) =>
    c.json(await service.detail(c.req.param('id'), c.get('actor')?.id ?? null)),
  );
  app.post('/api/v1/problems', async (c) =>
    c.json(await service.createProblem(actor(c), await json(c)), 201),
  );
  app.patch('/api/v1/problems/:id', async (c) =>
    c.json(await service.editProblem(actor(c), c.req.param('id'), await json(c))),
  );
  app.put('/api/v1/problems/:id/participation', async (c) =>
    c.json(await service.participate(actor(c), c.req.param('id'), await json(c))),
  );
  app.post('/api/v1/problems/:id/comments', async (c) =>
    c.json(await service.comment(actor(c), c.req.param('id'), await json(c)), 201),
  );
  app.post('/api/v1/problems/:id/solutions', async (c) =>
    c.json(await service.addSolution(actor(c), c.req.param('id'), await json(c)), 201),
  );
  app.patch('/api/v1/solutions/:id', async (c) =>
    c.json(await service.editSolution(actor(c), c.req.param('id'), await json(c))),
  );
  app.get('/api/v1/solutions/:id', async (c) =>
    c.json(await service.getSolution(c.req.param('id'), c.get('actor')?.id ?? null)),
  );
  app.put('/api/v1/solutions/:id/tests', async (c) =>
    c.json(await service.test(actor(c), c.req.param('id'), await json(c))),
  );
  app.post('/api/v1/reports', async (c) =>
    c.json(await service.report(actor(c), await json(c)), 201),
  );
  app.post('/api/v1/problems/:id/reopen', async (c) =>
    c.json(await service.reopen(actor(c), c.req.param('id'), await json(c)), 201),
  );
  app.post('/api/v1/attachments', async (c) => {
    const body = await c.req.parseBody();
    const targetType = z.enum(['problem', 'solution']).parse(body.targetType);
    const targetId = z.string().min(1).parse(body.targetId);
    if (!(body.file instanceof File)) fail(422, 'invalid_upload', 'Choose an image to upload.');
    return c.json(await service.upload(actor(c), targetType, targetId, body.file), 201);
  });
  app.get('/api/v1/attachments/:id', async (c) => {
    const image = await service.image(c.req.param('id'), c.get('actor')?.id ?? null);
    return new Response(image.bytes as Uint8Array<ArrayBuffer>, {
      headers: {
        'Content-Type': image.mime,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'",
        'Cache-Control': 'private, max-age=60',
      },
    });
  });
  app.delete('/api/v1/attachments/:id', async (c) =>
    c.json(await service.deleteImage(actor(c), c.req.param('id'))),
  );
  app.get('/api/v1/moderation', async (c) => c.json(await service.moderation(actor(c))));
  app.post('/api/v1/moderation/solutions/:id/verify', async (c) =>
    c.json(await service.verify(actor(c), c.req.param('id'), await json(c))),
  );
  app.post('/api/v1/moderation/problems/:id/status', async (c) =>
    c.json(await service.status(actor(c), c.req.param('id'), await json(c))),
  );
  app.post('/api/v1/moderation/content', async (c) =>
    c.json(await service.hide(actor(c), await json(c))),
  );
  app.post('/api/v1/moderation/profiles/:id/restrict', async (c) =>
    c.json(await service.restrict(actor(c), c.req.param('id'), await json(c))),
  );
  app.get('/api/v1/moderation/merge-preview', async (c) =>
    c.json(
      await service.mergePreview(
        actor(c),
        z.string().min(1).parse(c.req.query('sourceId')),
        z.string().min(1).parse(c.req.query('targetId')),
      ),
    ),
  );
  app.post('/api/v1/moderation/merge', async (c) =>
    c.json(await service.merge(actor(c), await json(c))),
  );
  app.post('/api/v1/moderation/reports/:id/resolve', async (c) =>
    c.json(await service.resolveReport(actor(c), c.req.param('id'), await json(c))),
  );
  app.notFound((c) =>
    c.json({ error: 'not_found', message: 'This endpoint does not exist.' }, 404),
  );
  app.onError((error, c) => {
    if (error instanceof z.ZodError)
      return c.json(
        {
          error: 'validation_error',
          message: error.issues[0]?.message ?? 'Check the form fields.',
          details: error.issues,
          requestId: c.get('requestId'),
        },
        422,
      );
    if (error instanceof ApiFailure)
      return c.json(
        {
          error: error.code,
          message: error.message,
          details: error.details,
          requestId: c.get('requestId'),
        },
        error.status as 400,
      );
    // Log a correlation id and error class, never request tokens, private form bodies, or credentials.
    console.error(
      JSON.stringify({
        level: 'error',
        requestId: c.get('requestId'),
        name: error.name,
        message: 'Unhandled API failure',
      }),
    );
    return c.json(
      {
        error: 'internal_error',
        message: 'Something went wrong. Your change was not confirmed as saved.',
        requestId: c.get('requestId'),
      },
      500,
    );
  });
  return app;
}
