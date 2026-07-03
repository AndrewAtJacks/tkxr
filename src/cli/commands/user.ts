import chalk from 'chalk';
import type minimist from 'minimist';
import { createStorage } from '../../core/storage.js';
import { notifier } from '../../core/notifier.js';

interface UserArgs extends minimist.ParsedArgs {
  _: string[];
  email?: string;
  unassign?: boolean;
  username?: string;
  'display-name'?: string;
  'clear-email'?: boolean;
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
    case 'assign':
      await assignUser(rest, args);
      break;
    case 'edit':
      await editUser(rest, args);
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
  console.log('  assign <ticket-id> <user>         Assign a ticket to a user (id or username)');
  console.log('  assign <ticket-id> --unassign     Clear ticket assignee');
  console.log('  edit <id-or-username> [options]   Edit user fields (username/display-name/email)');
  console.log();
  console.log(chalk.green('Options:'));
  console.log('  --email <email>                   Email address (optional)');
  console.log('  --unassign                        Clear ticket assignee');
  console.log();
  console.log(chalk.green('Examples:'));
  console.log('  tkxr user create johndoe "John Doe"');
  console.log('  tkxr user create alice "Alice Smith" --email alice@example.com');
  console.log('  tkxr user assign tas-abc123 johndoe');
  console.log('  tkxr user assign tas-abc123 --unassign');
  console.log('  tkxr user edit johndoe --display-name "John D." --email john@example.com');
  console.log('  tkxr user edit use-abc123 --username jd --clear-email');
}

async function createUser(rest: string[], args: UserArgs): Promise<void> {
  const [username, displayName] = rest;
  
  if (!username || !displayName) {
    console.error(chalk.red('Username and display name are required.'));
    console.log(chalk.gray('Usage: tkxr user create <username> <displayName>'));
    process.exit(1);
  }

  try {
    const storage = await createStorage();
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

async function assignUser(rest: string[], args: UserArgs): Promise<void> {
  const [ticketId, userRef] = rest;

  if (!ticketId) {
    console.error(chalk.red('Ticket ID is required.'));
    console.log(chalk.gray('Usage: tkxr user assign <ticket-id> <user-id-or-username>'));
    console.log(chalk.gray('       tkxr user assign <ticket-id> --unassign'));
    process.exit(1);
  }

  if (!userRef && !args.unassign) {
    console.error(chalk.red('User (id or username) or --unassign is required.'));
    console.log(chalk.gray('Usage: tkxr user assign <ticket-id> <user-id-or-username>'));
    process.exit(1);
  }

  try {
    const storage = await createStorage();

    const found = await storage.findTicket(ticketId);
    if (!found) {
      console.error(chalk.red(`Ticket "${ticketId}" not found.`));
      process.exit(1);
    }

    let assigneeId: string | undefined;
    let userLabel = '(none)';

    if (args.unassign) {
      assigneeId = undefined;
    } else {
      const users = await storage.getUsers();
      const user = users.find(u => u.id === userRef || u.username === userRef);
      if (!user) {
        console.error(chalk.red(`User "${userRef}" not found.`));
        console.log(chalk.gray('Run "tkxr users" to see available users.'));
        process.exit(1);
      }
      assigneeId = user.id;
      userLabel = `${user.displayName} (@${user.username})`;
    }

    const updated = await storage.updateTicket(ticketId, { assignee: assigneeId });
    if (!updated) {
      console.error(chalk.red(`Failed to update ticket "${ticketId}".`));
      process.exit(1);
    }

    await notifier.notifyTicketUpdated(updated);

    console.log(chalk.green.bold(args.unassign ? '✓ Ticket unassigned!' : '✓ Ticket assigned!'));
    console.log();
    console.log(chalk.white.bold(updated.title));
    console.log(chalk.gray(`  ID: ${updated.id}`));
    console.log(chalk.gray(`  Assignee: `) + chalk.cyan(userLabel));

  } catch (error) {
    console.error(chalk.red('Error assigning user:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function editUser(rest: string[], args: UserArgs): Promise<void> {
  const [ref] = rest;

  if (!ref) {
    console.error(chalk.red('User id or username is required.'));
    console.log(chalk.gray('Usage: tkxr user edit <id-or-username> [--username …] [--display-name …] [--email …] [--clear-email]'));
    process.exit(1);
  }

  const updates: Partial<{ username: string; displayName: string; email: string | undefined }> = {};
  if (args.username !== undefined) updates.username = String(args.username);
  if (args['display-name'] !== undefined) updates.displayName = String(args['display-name']);
  if (args['clear-email']) updates.email = undefined;
  else if (args.email !== undefined) updates.email = String(args.email);

  if (Object.keys(updates).length === 0) {
    console.log(chalk.yellow('No changes specified. See "user help" for options.'));
    return;
  }

  try {
    const storage = await createStorage();
    const users = await storage.getUsers();
    const target = users.find(u => u.id === ref || u.username === ref);
    if (!target) {
      console.error(chalk.red(`User "${ref}" not found.`));
      process.exit(1);
    }

    const updated = await storage.updateUser(target.id, updates as any);
    if (!updated) {
      console.error(chalk.red(`Failed to update user "${ref}".`));
      process.exit(1);
    }

    await notifier.notifyUserUpdated(updated);

    console.log(chalk.green.bold('✓ User updated!'));
    console.log();
    console.log(chalk.white.bold(`${updated.displayName} (@${updated.username})`));
    console.log(chalk.gray(`  ID: ${updated.id}`));
    if (updated.email) console.log(chalk.gray(`  Email: ${updated.email}`));

  } catch (error) {
    console.error(chalk.red('Error editing user:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}