import { defineConfig } from 'vite';
import reactTailwind from '@tailwindcss/vite';
export default defineConfig({
  plugins: [reactTailwind()],
  server: { host: '127.0.0.1', port: 5173, proxy: { '/api': 'http://127.0.0.1:8787' } },
  build: { target: 'es2022' },
});
