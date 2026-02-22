#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

try {
  const rootPkgPath = join(__dirname, '..', 'package.json');
  const distDir = join(__dirname, '..', 'dist');
  const distPkgPath = join(distDir, 'package.json');

  const pkg = JSON.parse(readFileSync(rootPkgPath, 'utf8'));

  // Ensure dist directory exists
  try { mkdirSync(distDir, { recursive: true }); } catch (e) { /* ignore */ }

  writeFileSync(distPkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log('✓ Copied package.json to dist/');
} catch (error) {
  console.error('Failed to copy package.json to dist:', error);
  process.exitCode = 1;
}
