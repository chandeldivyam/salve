import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/bin/salve.ts'],
  format: 'esm',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  minify: true,
  deps: {
    alwaysBundle: [/^@salve\//],
    onlyBundle: false,
  },
});
