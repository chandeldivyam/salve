import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/server.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  // Workspace deps (@salve/*) get bundled inline so the runtime image doesn't
  // need to resolve workspace symlinks. External prod deps (better-auth, hono,
  // postgres, etc.) stay as imports — `pnpm deploy --prod` ships them in
  // node_modules at the runtime stage.
  deps: {
    alwaysBundle: [/^@salve\//],
    onlyBundle: false,
  },
});
