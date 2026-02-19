import chalk from 'chalk';
import type minimist from 'minimist';
import { FileStorage } from '../../core/storage.js';

interface UsersArgs extends minimist.ParsedArgs {
  _: string[];
}

export async function listUsers(args: UsersArgs): Promise<void> {
  try {
    const storage = new FileStorage();
    const users = await storage.getUsers();

    if (users.length === 0) {
      console.log(chalk.yellow('No users found.'));
      return;
    }

    console.log(chalk.blue.bold(`Found ${users.length} user${users.length === 1 ? '' : 's'}:`));
    console.log();

    for (const user of users) {
      console.log(chalk.white.bold(`${user.displayName} (@${user.username})`));
      console.log(chalk.gray(`  ID: ${user.id}`));
      if (user.email) {
        console.log(chalk.gray(`  Email: ${user.email}`));
      }
      console.log(chalk.gray(`  Created: ${new Date(user.createdAt).toLocaleDateString()}`));
      console.log();
    }
  } catch (error) {
    console.error(chalk.red('Error listing users:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}