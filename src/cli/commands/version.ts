import chalk from 'chalk';
import type minimist from 'minimist';
import { promises as fs } from 'fs';
import path from 'path';

interface VersionArgs extends minimist.ParsedArgs {
  bump?: 'patch' | 'minor' | 'major';
}

function parseVersion(version: string): [number, number, number] {
  const parts = version.split('.').map(Number);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function formatVersion(major: number, minor: number, patch: number): string {
  return `${major}.${minor}.${patch}`;
}

function bumpVersion(version: string, type: 'patch' | 'minor' | 'major'): string {
  const [major, minor, patch] = parseVersion(version);
  
  switch (type) {
    case 'major':
      return formatVersion(major + 1, 0, 0);
    case 'minor':
      return formatVersion(major, minor + 1, 0);
    case 'patch':
      return formatVersion(major, minor, patch + 1);
    default:
      return version;
  }
}

async function updatePackageVersion(filePath: string, newVersion: string): Promise<void> {
  const content = await fs.readFile(filePath, 'utf8');
  const pkg = JSON.parse(content);
  pkg.version = newVersion;
  await fs.writeFile(filePath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
}

export async function manageVersion(args: VersionArgs): Promise<void> {
  try {
    const rootPkgPath = path.join(process.cwd(), 'package.json');
    const webPkgPath = path.join(process.cwd(), 'src', 'web', 'package.json');
    
    // Read current version from root package.json
    const rootPkgContent = await fs.readFile(rootPkgPath, 'utf8');
    const rootPkg = JSON.parse(rootPkgContent);
    const currentVersion = rootPkg.version || '0.0.0';
    
    // If no bump type specified, just show current version
    if (!args.bump) {
      console.log(chalk.blue('Current version:'), chalk.bold(currentVersion));
      
      // Check if web version is in sync
      try {
        const webPkgContent = await fs.readFile(webPkgPath, 'utf8');
        const webPkg = JSON.parse(webPkgContent);
        const webVersion = webPkg.version || '0.0.0';
        
        if (webVersion !== currentVersion) {
          console.log(chalk.yellow('⚠️  Web package version is out of sync:'), webVersion);
          console.log(chalk.gray('   Run "tkxr version --bump patch" to sync versions'));
        } else {
          console.log(chalk.green('✓ All packages are in sync'));
        }
      } catch (error) {
        // Web package might not exist
      }
      
      console.log();
      console.log(chalk.gray('To bump version, use:'));
      console.log(chalk.gray('  tkxr version --bump patch   # 1.0.0 → 1.0.1'));
      console.log(chalk.gray('  tkxr version --bump minor   # 1.0.0 → 1.1.0'));
      console.log(chalk.gray('  tkxr version --bump major   # 1.0.0 → 2.0.0'));
      return;
    }
    
    // Validate bump type
    if (!['patch', 'minor', 'major'].includes(args.bump)) {
      console.log(chalk.red('Error: Invalid bump type. Use patch, minor, or major'));
      process.exit(1);
    }
    
    // Calculate new version
    const newVersion = bumpVersion(currentVersion, args.bump);
    
    console.log(chalk.blue('Version bump:'), chalk.dim(currentVersion), '→', chalk.bold.green(newVersion));
    
    // Update root package.json
    await updatePackageVersion(rootPkgPath, newVersion);
    console.log(chalk.green('✓ Updated root package.json'));
    
    // Update web package.json
    try {
      await updatePackageVersion(webPkgPath, newVersion);
      console.log(chalk.green('✓ Updated web package.json'));
    } catch (error) {
      console.log(chalk.yellow('⚠️  Could not update web package.json'));
    }
    
    console.log();
    console.log(chalk.gray('Next steps:'));
    console.log(chalk.gray('  1. Commit the changes: git add package.json src/web/package.json'));
    console.log(chalk.gray(`  2. Create a tag: git tag v${newVersion}`));
    console.log(chalk.gray('  3. Push: git push && git push --tags'));
    
  } catch (error) {
    console.log(chalk.red('Error managing version:'), error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
