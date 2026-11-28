import { http_route } from '../generated/tracker_core.js';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import { ContractError, schema } from '@tracker/contracts';
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
  const json = async (c: { req: { json: () => Promise<unknown> } }) => {
    try {
      return await c.req.json();
    } catch {
      fail(400, 'invalid_json', 'Send a valid JSON request.');
    }
  };
  app.all('*', async (c) => {
    const method = c.req.method === 'HEAD' ? 'GET' : c.req.method;
    const route = JSON.parse(http_route(method, c.req.path, settings.demo)) as {
      op: string;
      id: string;
      private: boolean;
      schema: string | null;
      status: 200 | 201;
    } | null;
    if (!route)
      return c.json({ error: 'not_found', message: 'This endpoint does not exist.' }, 404);
    const user = c.get('actor')?.id ?? null;
    const requireActor = () => user ?? fail(401, 'unauthorized', 'Please sign in to continue.');
    const checksBodyFirst = route.op === 'markNotification' || route.op === 'upload';
    if (route.private && !checksBodyFirst) requireActor();
    let id = route.id;
    try {
      id = decodeURIComponent(id);
    } catch {
      /* Leave malformed URI escapes as path data. */
    }
    const data = route.schema
      ? schema<Record<string, unknown>>(route.schema).parse(await json(c))
      : {};
    if (route.op === 'markNotification') requireActor();
    switch (route.op) {
      case 'health':
        if (settings.health) await settings.health();
        return c.json({ status: 'ok', mode: settings.demo ? 'local-demo' : 'production' });
      case 'config':
        return c.json({
          demo: settings.demo,
          configuredAuth: settings.configuredAuth,
          providers: ['google', 'github', 'azure'],
          demoAccounts: settings.demo ? demoProfiles : [],
        });
      case 'openapi':
        return c.json(openapi(settings.demo));
      case 'demo':
        return c.json({
          token: 'demo:' + data.userId,
          profile: await service.me(String(data.userId)),
        });
      case 'me':
        return c.json(await service.me(user!));
      case 'feed': {
        const sort = schema<FeedSort>('sort').parse(c.req.query('sort') ?? 'trending');
        const rawCategory = c.req.query('category');
        const category =
          rawCategory === undefined ? undefined : schema<string>('category').parse(rawCategory);
        const rawQuery = c.req.query('q');
        const q = rawQuery === undefined ? undefined : schema<string>('query').parse(rawQuery);
        const rawOffset = Number(c.req.query('offset') ?? 0);
        // JSON cannot carry non-finite values. Preserve the original diagnostic at the ABI.
        const offset = schema<number>('offset').parse(
          Number.isFinite(rawOffset) ? rawOffset : String(rawOffset),
        );
        return c.json(await service.feed(user, sort, category, q, offset));
      }
      case 'mergePreview':
        return c.json(
          await service.mergePreview(
            user!,
            schema<string>('identifier').parse(c.req.query('sourceId')),
            schema<string>('identifier').parse(c.req.query('targetId')),
          ),
        );
      case 'image': {
        const image = await service.image(id, user);
        return new Response(image.bytes as Uint8Array<ArrayBuffer>, {
          headers: {
            'Content-Type': image.mime,
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'",
            'Cache-Control': 'private, max-age=60',
          },
        });
      }
      case 'upload': {
        const form = await c.req.parseBody();
        const type = schema<'problem' | 'solution'>('attachmentType').parse(form.targetType);
        const target = schema<string>('identifier').parse(form.targetId);
        if (!(form.file instanceof File)) fail(422, 'invalid_upload', 'Choose an image to upload.');
        return c.json(await service.upload(requireActor(), type, target, form.file), 201);
      }
      case 'deleteImage':
        return c.json(await service.deleteImage(user!, id));
      default:
        if (method === 'GET')
          return c.body(await service.readBody(route.op, user, id), 200, {
            'Content-Type': 'application/json',
          });
        return c.json(
          (await service.executeWrite(route.op, requireActor(), id, data)) as object,
          route.status,
        );
    }
  });
  app.onError((error, c) => {
    if (error instanceof ContractError)
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
