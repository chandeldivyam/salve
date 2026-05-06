import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/handler.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
});
