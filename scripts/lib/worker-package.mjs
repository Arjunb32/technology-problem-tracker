import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

// Cloudflare supplies WebAssembly.Module imports. Keep that interface in the Node test host.
registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith('.wasm')) return nextLoad(url, context);
    const base64 = readFileSync(new URL(url)).toString('base64');
    return {
      format: 'module',
      shortCircuit: true,
      source: "export default new WebAssembly.Module(Buffer.from('" + base64 + "', 'base64'))",
    };
  },
});

export async function loadWorker(file) {
  return (await import(pathToFileURL(file).href)).default;
}
