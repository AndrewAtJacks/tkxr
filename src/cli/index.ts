#!/usr/bin/env node

import minimist from 'minimist';
import chalk from 'chalk';
import { createTicket } from './commands/create.js';
import { listTickets } from './commands/list.js';
import { deleteTicket } from './commands/delete.js';
import { updateTicketStatus } from './commands/status.js';
import { startServer } from './commands/serve.js';
import { listUsers } from './commands/users.js';
import { manageUser } from './commands/user.js';
import { listSprints } from './commands/sprints.js';
import { manageSprint } from './commands/sprint.js';
import { startMCPServer } from './commands/mcp.js';

interface Args extends minimist.ParsedArgs {
  _: string[];
  help?: boolean;
  version?: boolean;
}

const commands = {
  create: createTicket,
  list: listTickets,
  delete: deleteTicket,
  status: updateTicketStatus,
  serve: startServer,
  users: listUsers,
  user: manageUser,
  sprints: listSprints,
  sprint: manageSprint,
  mcp: startMCPServer,
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
  console.log('    Options:');
  console.log('      --search, -s <term>   Search tickets by title, description, or ID');
  console.log('      --sort-by <field>     Sort by: title, status, priority, created, updated');
  console.log('      --order <order>       Sort order: asc, desc (default: desc)');
  console.log('      --status <status>     Filter by status: todo, progress, done');
  console.log('      --assignee <id>       Filter by assignee ID');
  console.log('      --sprint <id>         Filter by sprint ID');
  console.log('  delete <id>               Delete a ticket');
  console.log('  status <id> <status>      Update ticket status (todo, progress, done)');
  console.log();
  console.log(chalk.green('User Commands:'));
  console.log('  users                     List all users');
  console.log('  user create <username> <name>  Create a new user');
  console.log();
  console.log(chalk.green('Sprint Commands:'));
  console.log('  sprints                   List all sprints');
  console.log('  sprint create <name>      Create a new sprint');
  console.log('  sprint status <id> <status>  Update sprint status');
  console.log();
  console.log(chalk.green('Server Commands:'));
  console.log('  serve                     Start web interface server');
  console.log('  mcp                       Start MCP server for AI integration');
  console.log();
  console.log(chalk.green('Examples:'));
  console.log('  tkxr new task "Fix login bug"');
  console.log('  tkxr new bug "Dashboard crash"');
  console.log('  tkxr user create johndoe "John Doe"');
  console.log('  tkxr sprint create "Sprint 1"');
  console.log('  tkxr sprint status spr-123 active');
  console.log('  tkxr list tasks');
  console.log('  tkxr list --search "login"');
  console.log('  tkxr list --sort-by priority --order desc');
  console.log('  tkxr list --status progress --sort-by created');
  console.log('  tkxr status task-123 done');
  console.log('  tkxr serve');
  console.log('  tkxr mcp');
}

function showVersion() {
  console.log('tkxr v0.1.0');
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