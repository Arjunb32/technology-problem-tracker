import './node-runtime.mjs';
import { createServer } from 'node:http';
import { loadEnvFile } from 'node:process';
import { resolve, isAbsolute } from 'node:path';
import { LocalStore } from './local-store.js';
import { TrackerService } from './service.js';
import { createApp } from './app.js';
import { productionApp } from './worker.js';
import { fail } from './state.js';

for (const file of ['../../.env.local', '.env.local']) {
  try {
    loadEnvFile(resolve(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
const port = Number(process.env.PORT ?? 8787);
const demo = process.env.API_MODE !== 'supabase';
const publicUrl = process.env.API_PUBLIC_URL ?? `http://localhost:${port}`;
const configuredFile = process.env.DEMO_DATA_FILE ?? process.env.DATA_FILE ?? '.data/demo.json';
const store = new LocalStore(
  isAbsolute(configuredFile) ? configuredFile : resolve('../../', configuredFile),
);
const service = new TrackerService(store, publicUrl);
const app = demo
  ? createApp(
      service,
      {
        authenticate: async (token) => {
          if (!/^demo:demo-(alex|sam|morgan)$/.test(token))
            fail(401, 'unauthorized', 'Please choose a local demo account.');
          return service.me(token.slice(5));
        },
      },
      {
        demo: true,
        configuredAuth: false,
        origins: (
          process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173'
        ).split(','),
      },
    )
  : productionApp({
      SUPABASE_URL: process.env.SUPABASE_URL!,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173',
      API_PUBLIC_URL: publicUrl,
      APP_ENV: 'production',
    });
if (demo) await store.read();
createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 600 * 1024) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: 'payload_too_large', message: 'This request is too large.' }),
        );
        return;
      }
      chunks.push(chunk);
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers))
      if (value) headers.set(name, Array.isArray(value) ? value.join(',') : value);
    const request = new Request(`http://localhost:${port}${req.url ?? '/'}`, {
      method: req.method,
      headers,
      ...(['GET', 'HEAD'].includes(req.method ?? 'GET') ? {} : { body: Buffer.concat(chunks) }),
    });
    const response = await app.fetch(request);
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({ error: 'internal_error', message: 'The request could not be completed.' }),
    );
  }
}).listen(port, '127.0.0.1', () =>
  console.log(
    `Technology Problem Tracker API · ${demo ? 'local demonstration data' : 'Supabase'} · http://localhost:${port}`,
  ),
);
