import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const root = import.meta.dirname;

// The demo imports the Sigil library straight from source (`@sigil` → ../src), so it always tracks the API and
// never needs the library published. `server.fs.allow` lets the dev server read the parent src/ directory.
export default defineConfig({
  base: './',
  // Some injected deps (@didcid/cipher and friends) reference the Node global `global`; map it to `globalThis`.
  // `Buffer` is polyfilled at runtime in src/polyfills.ts.
  define: { global: 'globalThis' },
  resolve: { alias: { '@sigil': resolve(root, '../src/index.ts') } },
  server: { fs: { allow: [resolve(root, '..')] } },
});
