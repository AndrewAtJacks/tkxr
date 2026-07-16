import chalk from 'chalk';
import type minimist from 'minimist';
import { runMcpStdio } from '../../mcp/server.js';

interface McpArgs extends minimist.ParsedArgs {
  _: string[];
  help?: boolean;
}

export async function startMCPServer(args: McpArgs): Promise<void> {
  if (args.help) {
    showMCPHelp();
    return;
  }

  try {
    // MCP uses stdio JSON-RPC on stdout — any stdout write corrupts the protocol.
    // Log to stderr instead so AI clients (e.g. via `pnpm dlx @legdev/tkxr mcp`) can parse responses.
    console.error(chalk.blue.bold('Starting TKXR MCP Server...'));
    console.error(chalk.gray('MCP server allows AI assistants to manage tickets through CLI commands'));
    console.error();

    await runMcpStdio();

    // This line should never be reached since MCP servers run indefinitely
    console.error(chalk.green('MCP server started successfully'));
  } catch (error) {
    console.error(chalk.red('Failed to start MCP server:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function showMCPHelp() {
  console.log(chalk.blue.bold('TKXR MCP Server'));
  console.log();
  console.log(chalk.green('Usage:'));
  console.log('  tkxr mcp');
  console.log();
  console.log(chalk.green('Description:'));
  console.log('  Starts a Model Context Protocol (MCP) server that allows AI assistants');
  console.log('  to manage tickets, users, and sprints through standardized tool calls.');
  console.log();
  console.log(chalk.green('Available MCP Tools:'));
  console.log('  • list_tickets           - List all tickets in the repository');
  console.log('  • create_ticket          - Create a new ticket (task or bug)');
  console.log('  • update_ticket_status   - Update the status of a ticket');
  console.log('  • delete_ticket          - Delete a ticket from the repository');
  console.log('  • list_users             - List all users in the repository');
  console.log('  • create_user            - Create a new user');
  console.log('  • list_sprints           - List all sprints in the repository');
  console.log('  • create_sprint          - Create a new sprint');
  console.log('  • update_sprint_status   - Update the status of a sprint');
  console.log();
  console.log(chalk.green('Usage with AI:'));
  console.log('  Configure your AI assistant to connect to this MCP server to enable');
  console.log('  ticket management capabilities. The server communicates via stdio.');
  console.log();
  console.log(chalk.green('Examples:'));
  console.log('  tkxr mcp                 # Start MCP server');
  console.log();
  console.log(chalk.yellow('Note: MCP server runs until manually stopped (Ctrl+C)'));
}