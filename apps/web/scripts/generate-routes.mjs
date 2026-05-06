// Generates src/routeTree.gen.ts using @tanstack/router-generator's
// programmatic API. The Vite plugin does this on `vite build`, but
// `tsc --noEmit` (run by type-check + the first half of build) needs the
// file to exist beforehand. So we run the generator explicitly first.
//
// Mirrors the Vite plugin config in apps/web/vite.config.ts.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Generator, getConfig } from '@tanstack/router-generator';

const __filename = fileURLToPath(import.meta.url);
const root = resolve(dirname(__filename), '..');

const config = getConfig(
  {
    target: 'react',
    autoCodeSplitting: true,
    routesDirectory: './src/routes',
    generatedRouteTree: './src/routeTree.gen.ts',
  },
  root,
);

const generator = new Generator({ config, root });
await generator.run();
console.log('routeTree.gen.ts generated.');
