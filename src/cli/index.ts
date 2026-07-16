#!/usr/bin/env node

import minimist from 'minimist';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createTicket } from './commands/create.js';
import { listTickets } from './commands/list.js';
import { showTicket } from './commands/show.js';
import { deleteTicket } from './commands/delete.js';
import { updateTicketStatus } from './commands/status.js';
import { editTicket } from './commands/edit.js';
import { startServer } from './commands/serve.js';
import { listUsers } from './commands/users.js';
import { manageUser } from './commands/user.js';
import { listSprints } from './commands/sprints.js';
import { manageSprint } from './commands/sprint.js';
import { startMCPServer } from './commands/mcp.js';
import { manageComments } from './commands/comments.js';
import { manageVersion } from './commands/version.js';
import { manageWorktree } from './commands/worktree.js';

interface Args extends minimist.ParsedArgs {
  _: string[];
  help?: boolean;
  version?: boolean;
}

const commands = {
  create: createTicket,
  list: listTickets,
  show: showTicket,
  delete: deleteTicket,
  status: updateTicketStatus,
  edit: editTicket,
  serve: startServer,
  users: listUsers,
  user: manageUser,
  sprints: listSprints,
  sprint: manageSprint,
  comments: manageComments,
  mcp: startMCPServer,
  version: manageVersion,
  worktree: manageWorktree,
  new: createTicket, // Alias for create
};

function showHelp() {
  console.log(chalk.blue.bold('tkxr - In-repo ticket management system'));
  console.log();
  console.log(chalk.green('Usage:'));
  console.log('  tkxr <command> [options]');
  console.log();
  console.log(chalk.green('Ticket Commands:'));
  console.log('  create <type> <title>     Create a new ticket (task, bug)');
  console.log('  new <type> <title>        Alias for create');
  console.log('  list [type]               List tickets (optionally filter by type)');
  console.log('  show <id>                 Show detailed ticket information');
  console.log('    Options:');
  console.log('      --search, -s <term>   Search tickets by title, description, or ID');
  console.log('      --sort-by <field>     Sort by: title, status, priority, created, updated');
  console.log('      --order <order>       Sort order: asc, desc (default: desc)');
  console.log('      --status <status>     Filter by status: backlog, progress, review, blocked, done');
  console.log('      --assignee <id>       Filter by assignee ID');
  console.log('      --sprint <id>         Filter by sprint ID');
  console.log('      --verbose, -v         Show assignee and sprint names');
  console.log('  delete <id>               Delete a ticket, sprint, user, or comment');
  console.log('  status <id> <status>      Update ticket status (backlog, progress, review, blocked, done)');
  console.log('  edit <id> [options]       Edit ticket fields');
  console.log('    --title <text>          New title');
  console.log('    --description <text>    New description (or --clear-description)');
  console.log('    --priority <level>      low, medium, high, critical (or --clear-priority)');
  console.log('    --estimate <n>          Story points (or --clear-estimate)');
  console.log('    --add-label <label>     Add a label (repeatable)');
  console.log('    --remove-label <label>  Remove a label (repeatable)');
  console.log('    --clear-labels          Remove all labels');
  console.log('  comments <id>             List comments for a ticket');
  console.log('  comments <id> --add       Add a comment to a ticket');
  console.log('    --author <author-id>    Author of the comment (user ID or username)');
  console.log('    --content <text>        Comment content');
  console.log('  comments <id> --delete <comment-id>  Delete a comment');
  console.log();
  console.log(chalk.green('User Commands:'));
  console.log('  users                              List all users');
  console.log('  user create <username> <name>      Create a new user');
  console.log('  user assign <ticket-id> <user>     Assign a ticket to a user (id or username)');
  console.log('  user assign <ticket-id> --unassign Clear the ticket assignee');
  console.log('  user edit <id-or-username> [opts]  Edit user (username/display-name/email)');
  console.log();
  console.log(chalk.green('Sprint Commands:'));
  console.log('  sprints                            List all sprints');
  console.log('  sprint create <name>               Create a new sprint');
  console.log('  sprint status <id> <status>        Update sprint status');
  console.log('  sprint set <ticket-id> <sprint-id> Attach a ticket to a sprint');
  console.log('  sprint set <ticket-id> --unset     Remove a ticket from its sprint');
  console.log('  sprint edit <id> [opts]            Edit sprint (name/desc/goal/dates)');
  console.log();
  console.log(chalk.green('Server Commands:'));
  console.log('  serve                     Start web + REST + MCP-over-HTTP server');
  console.log('    Options:');
  console.log('      --port <number>       Server port (default: 8080)');
  console.log('                              Env fallback: TKXR_PORT, PORT');
  console.log('      --host <string>       Server host (default: localhost)');
  console.log('                              Env fallback: TKXR_HOST');
  console.log('    Endpoints:');
  console.log('      /                     Web UI');
  console.log('      /api/*                REST API (tickets, sprints, users, comments, worktrees)');
  console.log('      /mcp                  MCP JSON-RPC over HTTP (POST/GET/DELETE)');
  console.log('  mcp                       Start MCP stdio server (for MCP client configs)');
  console.log();
  console.log(chalk.green('Worktree Commands:'));
  console.log('  worktree create <id>      Create a git worktree + branch for a ticket');
  console.log('  worktree remove <id>      Remove the worktree associated with a ticket');
  console.log('  worktree list             List all git worktrees in this repo');
  console.log('    Env:');
  console.log('      TKXR_WORKTREE_ROOT    Base directory for default worktree paths');
  console.log('                              (default: ../<repo>-worktrees)');
  console.log();
  console.log(chalk.green('Version Commands:'));
  console.log('  version                   Show current version');
  console.log('  version --bump <type>     Bump version (patch, minor, major)');
  console.log();
  console.log(chalk.green('Examples:'));
  console.log('  tkxr new task "Fix login bug"');
  console.log('  tkxr new bug "Dashboard crash"');
  console.log('  tkxr user create johndoe "John Doe"');
  console.log('  tkxr sprint create "Sprint 1"');
  console.log('  tkxr sprint status spr-123 active');
  console.log('  tkxr user assign tas-abc johndoe');
  console.log('  tkxr sprint set tas-abc spr-123');
  console.log('  tkxr list tasks');
  console.log('  tkxr list --search "login"');
  console.log('  tkxr list --sort-by priority --order desc');
  console.log('  tkxr list --status progress --sort-by created');
  console.log('  tkxr status task-123 done');
  console.log('  tkxr edit tas-123 --priority high --add-label backend');
  console.log('  tkxr comments tas-123');
  console.log('  tkxr comments tas-123 --add --author johndoe --content "Fixed the issue"');
  console.log('  tkxr serve --port 3000');
  console.log('  tkxr mcp');
}

function showVersion() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const packageJsonPath = join(__dirname, '../../package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    console.log(`tkxr v${packageJson.version}`);
  } catch (error) {
    console.log('tkxr v1.0.0'); // Fallback version
  }
}

async function main() {
  const args: Args = minimist(process.argv.slice(2));
  
  if (args.help || args.h) {
    showHelp();
    return;
  }
  
  if (args.version || args.v) {
    showVersion();
    return;
  }
  
  const command = args._[0];
  
  if (!command) {
    console.log(chalk.red('Error: No command specified'));
    console.log('Run "tkxr --help" for usage information');
    process.exit(1);
  }
  
  const commandFn = commands[command as keyof typeof commands];
  
  if (!commandFn) {
    console.log(chalk.red(`Error: Unknown command "${command}"`));
    console.log('Run "tkxr --help" for available commands');
    process.exit(1);
  }
  
  try {
    await commandFn(args);
  } catch (error) {
    console.log(chalk.red(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('unhandledRejection', (error) => {
  console.log(chalk.red(`Unhandled error: ${error}`));
  process.exit(1);
});

main();