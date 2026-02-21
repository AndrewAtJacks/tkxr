#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function parseVersion(version) {
  const parts = version.split('.').map(Number);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function bumpPatch(version) {
  const [major, minor, patch] = parseVersion(version);
  return `${major}.${minor}.${patch + 1}`;
}

function updatePackageVersion(filePath, newVersion) {
  const content = readFileSync(filePath, 'utf8');
  const pkg = JSON.parse(content);
  const oldVersion = pkg.version;
  pkg.version = newVersion;
  writeFileSync(filePath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  return oldVersion;
}

try {
  // Read current version from root package.json
  const rootPkgPath = join(__dirname, '..', 'package.json');
  const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf8'));
  const currentVersion = rootPkg.version || '0.0.0';
  
  // Bump patch version
  const newVersion = bumpPatch(currentVersion);
  
  console.log(`🔢 Version bump: ${currentVersion} → ${newVersion}`);
  
  // Update root package.json
  updatePackageVersion(rootPkgPath, newVersion);
  console.log('   ✓ Updated root package.json');
  
  // Update web package.json
  const webPkgPath = join(__dirname, '..', 'src', 'web', 'package.json');
  try {
    updatePackageVersion(webPkgPath, newVersion);
    console.log('   ✓ Updated web package.json');
  } catch (error) {
    console.log('   ⚠️  Could not update web package.json');
  }
} catch (error) {
  console.error('❌ Error bumping version:', error.message);
  process.exit(1);
}
