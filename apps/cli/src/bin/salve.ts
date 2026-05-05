#!/usr/bin/env node
import { run } from '../main.js';

run(process.argv.slice(2)).catch((error) => {
  console.error(error);
  process.exitCode = 2;
});
