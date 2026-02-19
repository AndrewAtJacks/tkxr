import chalk from 'chalk';
import type minimist from 'minimist';
import { FileStorage } from '../../core/storage.js';

interface UserArgs extends minimist.ParsedArgs {
  _: string[];
  email?: string;
}

export async function manageUser(args: UserArgs): Promise<void> {
  const [, subcommand, ...rest] = args._; // Skip the 'user' command itself
  
  if (!subcommand || subcommand === 'help') {
    showUserHelp();
    return;
  }

  switch (subcommand) {
    case 'create':
      await createUser(rest, args);
      break;
    default:
      console.error(chalk.red(`Unknown user command: ${subcommand}`));
      console.log(chalk.gray('Use "user help" for available commands.'));
      process.exit(1);
  }
}

function showUserHelp() {
  console.log(chalk.blue.bold('User Management Commands:'));
  console.log();
  console.log(chalk.green('Usage:'));
  console.log('  tkxr user <command> [options]');
  console.log();
  console.log(chalk.green('Commands:'));
  console.log('  create <username> <displayName>   Create a new user');
  console.log();
  console.log(chalk.green('Options:'));
  console.log('  --email <email>                   Email address (optional)');
  console.log();
  console.log(chalk.green('Examples:'));
  console.log('  tkxr user create johndoe "John Doe"');
  console.log('  tkxr user create alice "Alice Smith" --email alice@example.com');
}

async function createUser(rest: string[], args: UserArgs): Promise<void> {
  const [username, displayName] = rest;
  
  if (!username || !displayName) {
    console.error(chalk.red('Username and display name are required.'));
    console.log(chalk.gray('Usage: tkxr user create <username> <displayName>'));
    process.exit(1);
  }

  try {
    const storage = new FileStorage();
    const user = await storage.createUser(username, displayName, {
      email: args.email,
    });

    console.log(chalk.green.bold('✓ User created successfully!'));
    console.log();
    console.log(chalk.white.bold(`${user.displayName} (@${user.username})`));
    console.log(chalk.gray(`  ID: ${user.id}`));
    if (user.email) {
      console.log(chalk.gray(`  Email: ${user.email}`));
    }
    console.log(chalk.gray(`  Created: ${new Date(user.createdAt).toLocaleDateString()}`));

  } catch (error) {
    console.error(chalk.red('Error creating user:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}