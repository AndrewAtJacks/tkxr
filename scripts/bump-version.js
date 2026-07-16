#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

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

function bumpMinor(version) {
  const [major, minor] = parseVersion(version);
  return `${major}.${minor + 1}.0`;
}

function bumpMajor(version) {
  const [major] = parseVersion(version);
  return `${major + 1}.0.0`;
}

function bumpVersion(version, level) {
  switch (level) {
    case 'major':
      return bumpMajor(version);
    case 'minor':
      return bumpMinor(version);
    case 'patch':
    default:
      return bumpPatch(version);
  }
}

function updatePackageVersion(filePath, newVersion) {
  const content = readFileSync(filePath, 'utf8');
  const pkg = JSON.parse(content);
  const oldVersion = pkg.version;
  pkg.version = newVersion;
  writeFileSync(filePath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  return oldVersion;
}

function updateChangelog(newVersion, level = 'patch') {
  const changelogPath = join(__dirname, '..', 'CHANGELOG.md');
  const date = new Date().toISOString().split('T')[0];
  const noteByLevel = {
    major: 'Major version bumped — see notes above for breaking changes.',
    minor: 'Minor version bumped.',
    patch: 'Patch version bumped automatically during build.',
  };
  const entry = `\n## [${newVersion}] - ${date}\n### Changed\n- ${noteByLevel[level] || noteByLevel.patch}\n`;
  let changelog = '';
  if (existsSync(changelogPath)) {
    changelog = readFileSync(changelogPath, 'utf8');
    const headingIdx = changelog.indexOf('# Changelog');
    if (headingIdx !== -1) {
      const afterHeadingIdx = changelog.indexOf('\n', headingIdx);
      changelog = changelog.slice(0, afterHeadingIdx + 1) + entry + changelog.slice(afterHeadingIdx + 1);
    } else {
      changelog = entry + changelog;
    }
  } else {
    changelog = `# Changelog\n${entry}`;
  }
  writeFileSync(changelogPath, changelog);
}

try {
  // Parse bump level from CLI args: `node bump-version.js [major|minor|patch]`
  const rawLevel = (process.argv[2] || 'patch').toLowerCase();
  const validLevels = ['major', 'minor', 'patch'];
  const level = validLevels.includes(rawLevel) ? rawLevel : 'patch';
  if (!validLevels.includes(rawLevel)) {
    console.log(`   ⚠️  Unknown bump level "${rawLevel}", defaulting to patch.`);
  }

  // Read current version from root package.json
  const rootPkgPath = join(__dirname, '..', 'package.json');
  const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf8'));
  const currentVersion = rootPkg.version || '0.0.0';

  // Bump according to requested level
  const newVersion = bumpVersion(currentVersion, level);

  console.log(`🔢 Version bump (${level}): ${currentVersion} → ${newVersion}`);

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

  // Append changelog entry for the new version
  try {
    updateChangelog(newVersion, level);
    console.log('   ✓ Updated CHANGELOG.md');
  } catch (error) {
    console.log('   ⚠️  Could not update CHANGELOG.md');
  }

  // Copying dist/package.json is handled by the build process to keep bump and build decoupled.
} catch (error) {
  console.error('❌ Error bumping version:', error.message);
  process.exit(1);
}
