#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  InitializeRequestSchema,
  ListToolsRequestSchema,
  ToolSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const execAsync = promisify(exec);

// Get the CLI path relative to the MCP server file location
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLI_PATH = path.join(__dirname, '..', 'cli', 'index.js');

/**
 * TKXR MCP Server - Allows AI to manage tickets through CLI commands
 */
class TKXRMCPServer {
  private server: Server;
  private workingDir: string;

  constructor(workingDir?: string) {
    this.workingDir = workingDir || process.cwd();
    this.server = new Server(
      {
        name: 'tkxr-mcp',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers() {
    // Handle initialization
    this.server.setRequestHandler(InitializeRequestSchema, async (request) => {
      return {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'tkxr-mcp',
          version: '0.1.0',
        },
      };
    });

    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'list_tickets',
            description: 'List all tickets in the repository',
            inputSchema: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: ['task', 'bug'],
                  description: 'Filter by ticket type (optional)',
                },
                status: {
                  type: 'string',
                  enum: ['todo', 'progress', 'done'],
                  description: 'Filter by status (optional)',
                },
              },
            },
          },
          {
            name: 'create_ticket',
            description: 'Create a new ticket (task or bug)',
            inputSchema: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: ['task', 'bug'],
                  description: 'Type of ticket to create',
                },
                title: {
                  type: 'string',
                  description: 'Title of the ticket',
                },
                description: {
                  type: 'string',
                  description: 'Description of the ticket (optional)',
                },
                assignee: {
                  type: 'string',
                  description: 'User ID to assign the ticket to (optional)',
                },
                sprint: {
                  type: 'string',
                  description: 'Sprint ID to add the ticket to (optional)',
                },
                priority: {
                  type: 'string',
                  enum: ['low', 'medium', 'high'],
                  description: 'Priority level (optional)',
                },
                estimate: {
                  type: 'number',
                  description: 'Story points estimate (optional)',
                },
              },
              required: ['type', 'title'],
            },
          },
          {
            name: 'update_ticket_status',
            description: 'Update the status of a ticket',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'Ticket ID',
                },
                status: {
                  type: 'string',
                  enum: ['todo', 'progress', 'done'],
                  description: 'New status',
                },
              },
              required: ['id', 'status'],
            },
          },
          {
            name: 'delete_ticket',
            description: 'Delete a ticket from the repository',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'Ticket ID to delete',
                },
              },
              required: ['id'],
            },
          },
          {
            name: 'list_users',
            description: 'List all users in the repository',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'create_user',
            description: 'Create a new user',
            inputSchema: {
              type: 'object',
              properties: {
                username: {
                  type: 'string',
                  description: 'Username',
                },
                displayName: {
                  type: 'string',
                  description: 'Display name',
                },
                email: {
                  type: 'string',
                  description: 'Email address (optional)',
                },
              },
              required: ['username', 'displayName'],
            },
          },
          {
            name: 'list_sprints',
            description: 'List all sprints in the repository',
            inputSchema: {
              type: 'object',
              properties: {
                status: {
                  type: 'string',
                  enum: ['planning', 'active', 'completed'],
                  description: 'Filter by sprint status (optional)',
                },
              },
            },
          },
          {
            name: 'create_sprint',
            description: 'Create a new sprint',
            inputSchema: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'Sprint name',
                },
                description: {
                  type: 'string',
                  description: 'Sprint description (optional)',
                },
                goal: {
                  type: 'string',
                  description: 'Sprint goal (optional)',
                },
              },
              required: ['name'],
            },
          },
          {
            name: 'update_sprint_status',
            description: 'Update the status of a sprint',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'Sprint ID',
                },
                status: {
                  type: 'string',
                  enum: ['planning', 'active', 'completed'],
                  description: 'New status',
                },
              },
              required: ['id', 'status'],
            },
          },
          {
            name: 'list_comments',
              description: 'List all comments for a specific ticket. Usage: list_comments {ticketId}',
            inputSchema: {
              type: 'object',
              properties: {
                ticketId: {
                  type: 'string',
                  description: 'Ticket ID (e.g., tas-123 or bug-456)',
                },
              },
              required: ['ticketId'],
            },
          },
          {
            name: 'add_comment',
              description: 'Add a comment to a ticket. Usage: add_comment {ticketId} --author {authorId} --content {content}',
            inputSchema: {
              type: 'object',
              properties: {
                ticketId: {
                  type: 'string',
                  description: 'Ticket ID (e.g., tas-123 or bug-456)',
                },
                author: {
                  type: 'string',
                  description: 'Author user ID or username',
                },
                content: {
                  type: 'string',
                  description: 'Comment content',
                },
              },
              required: ['ticketId', 'author', 'content'],
            },
          },
          {
            name: 'delete_comment',
            description: 'Delete a comment from a ticket',
            inputSchema: {
              type: 'object',
              properties: {
                ticketId: { type: 'string', description: 'Ticket ID the comment belongs to' },
                commentId: { type: 'string', description: 'Comment ID to delete' },
              },
              required: ['ticketId', 'commentId'],
            },
          },
          {
            name: 'edit_ticket',
            description: 'Edit ticket fields (title, description, priority, estimate, labels). Any provided field is updated.',
            inputSchema: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Ticket ID' },
                title: { type: 'string', description: 'New title (optional)' },
                description: { type: 'string', description: 'New description (optional)' },
                priority: {
                  type: 'string',
                  enum: ['low', 'medium', 'high', 'critical'],
                  description: 'Priority level (optional)',
                },
                estimate: { type: 'number', description: 'Story points (optional)' },
                addLabels: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Labels to add (optional)',
                },
                removeLabels: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Labels to remove (optional)',
                },
                clearLabels: { type: 'boolean', description: 'Remove all labels (optional)' },
                clearDescription: { type: 'boolean', description: 'Clear description (optional)' },
                clearPriority: { type: 'boolean', description: 'Clear priority (optional)' },
                clearEstimate: { type: 'boolean', description: 'Clear estimate (optional)' },
              },
              required: ['id'],
            },
          },
          {
            name: 'assign_ticket',
            description: 'Assign a ticket to a user, or unassign it',
            inputSchema: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Ticket ID' },
                user: { type: 'string', description: 'User ID or username (omit if unassigning)' },
                unassign: { type: 'boolean', description: 'Clear the ticket assignee' },
              },
              required: ['id'],
            },
          },
          {
            name: 'set_ticket_sprint',
            description: 'Attach a ticket to a sprint, or remove it',
            inputSchema: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Ticket ID' },
                sprintId: { type: 'string', description: 'Sprint ID (omit if unsetting)' },
                unset: { type: 'boolean', description: 'Remove the ticket from its sprint' },
              },
              required: ['id'],
            },
          },
          {
            name: 'edit_sprint',
            description: 'Edit sprint fields (name, description, goal, start/end dates)',
            inputSchema: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Sprint ID' },
                name: { type: 'string', description: 'New name (optional)' },
                description: { type: 'string', description: 'New description (optional)' },
                goal: { type: 'string', description: 'New goal (optional)' },
                startDate: { type: 'string', description: 'ISO date (optional)' },
                endDate: { type: 'string', description: 'ISO date (optional)' },
                clearDescription: { type: 'boolean' },
                clearGoal: { type: 'boolean' },
                clearStartDate: { type: 'boolean' },
                clearEndDate: { type: 'boolean' },
              },
              required: ['id'],
            },
          },
          {
            name: 'edit_user',
            description: 'Edit user fields (username, displayName, email)',
            inputSchema: {
              type: 'object',
              properties: {
                ref: { type: 'string', description: 'User ID or username' },
                username: { type: 'string', description: 'New username (optional)' },
                displayName: { type: 'string', description: 'New display name (optional)' },
                email: { type: 'string', description: 'New email (optional)' },
                clearEmail: { type: 'boolean', description: 'Clear email (optional)' },
              },
              required: ['ref'],
            },
          },
          {
            name: 'delete_entity',
            description: 'Delete any entity (sprint, user, or comment) by ID. For tickets prefer delete_ticket.',
            inputSchema: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Entity ID' },
              },
              required: ['id'],
            },
          },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'list_tickets':
            return await this.listTickets(args);
          case 'create_ticket':
            return await this.createTicket(args);
          case 'update_ticket_status':
            return await this.updateTicketStatus(args);
          case 'delete_ticket':
            return await this.deleteTicket(args);
          case 'list_users':
            return await this.listUsers(args);
          case 'create_user':
            return await this.createUser(args);
          case 'list_sprints':
            return await this.listSprints(args);
          case 'create_sprint':
            return await this.createSprint(args);
          case 'update_sprint_status':
            return await this.updateSprintStatus(args);
          case 'list_comments':
            return await this.listComments(args);
          case 'add_comment':
            return await this.addComment(args);
          case 'delete_comment':
            return await this.deleteComment(args);
          case 'edit_ticket':
            return await this.editTicket(args);
          case 'assign_ticket':
            return await this.assignTicket(args);
          case 'set_ticket_sprint':
            return await this.setTicketSprint(args);
          case 'edit_sprint':
            return await this.editSprint(args);
          case 'edit_user':
            return await this.editUser(args);
          case 'delete_entity':
            return await this.deleteEntity(args);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error executing ${name}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    });
  }

  private async runCLI(command: string[]): Promise<string> {
    const cmd = `node "${CLI_PATH}" ${command.map(arg => `"${arg}"`).join(' ')}`;
    const { stdout, stderr } = await execAsync(cmd, { cwd: this.workingDir });
    
    if (stderr && !stderr.includes('Warning')) {
      throw new Error(stderr);
    }
    
    return stdout.trim();
  }

  private async listTickets(args: any) {
    const command = ['list'];
    if (args.type) command.push('--type', args.type);
    if (args.status) command.push('--status', args.status);
    
    const output = await this.runCLI(command);
    return {
      content: [
        {
          type: 'text',
          text: output,
        },
      ],
    };
  }

  private async createTicket(args: any) {
    const command = ['create', args.type, args.title];
    if (args.description) command.push('--description', args.description);
    if (args.assignee) command.push('--assignee', args.assignee);
    if (args.sprint) command.push('--sprint', args.sprint);
    if (args.priority) command.push('--priority', args.priority);
    if (args.estimate) command.push('--estimate', args.estimate.toString());
    
    const output = await this.runCLI(command);
    return {
      content: [
        {
          type: 'text',
          text: output,
        },
      ],
    };
  }

  private async updateTicketStatus(args: any) {
    const command = ['status', args.id, args.status];
    const output = await this.runCLI(command);
    return {
      content: [
        {
          type: 'text',
          text: output,
        },
      ],
    };
  }

  private async deleteTicket(args: any) {
    const command = ['delete', args.id, '--force'];
    const output = await this.runCLI(command);
    return {
      content: [
        {
          type: 'text',
          text: output,
        },
      ],
    };
  }

  private async listUsers(args: any) {
    const command = ['users'];
    const output = await this.runCLI(command);
    return {
      content: [
        {
          type: 'text',
          text: output,
        },
      ],
    };
  }

  private async createUser(args: any) {
    const command = ['user', 'create', args.username, args.displayName];
    if (args.email) command.push('--email', args.email);
    
    const output = await this.runCLI(command);
    return {
      content: [
        {
          type: 'text',
          text: output,
        },
      ],
    };
  }

  private async listSprints(args: any) {
    const command = ['sprints'];
    if (args.status) command.push('--status', args.status);
    
    const output = await this.runCLI(command);
    return {
      content: [
        {
          type: 'text',
          text: output,
        },
      ],
    };
  }

  private async createSprint(args: any) {
    const command = ['sprint', 'create', args.name];
    if (args.description) command.push('--description', args.description);
    if (args.goal) command.push('--goal', args.goal);
    
    const output = await this.runCLI(command);
    return {
      content: [
        {
          type: 'text',
          text: output,
        },
      ],
    };
  }

  private async updateSprintStatus(args: any) {
    const command = ['sprint', 'status', args.id, args.status];
    const output = await this.runCLI(command);
    return {
      content: [
        {
          type: 'text',
          text: output,
        },
      ],
    };
  }

  private async listComments(args: any) {
    const command = ['comments', args.ticketId];
    const output = await this.runCLI(command);
    return {
      content: [
        {
          type: 'text',
          text: output,
        },
      ],
    };
  }

  private async addComment(args: any) {
    const command = ['comments', args.ticketId, '--add', '--author', args.author, '--content', args.content];
    const output = await this.runCLI(command);
    return {
      content: [
        {
          type: 'text',
          text: output,
        },
      ],
    };
  }

  private async deleteComment(args: any) {
    const command = ['comments', args.ticketId, '--delete', args.commentId];
    const output = await this.runCLI(command);
    return { content: [{ type: 'text', text: output }] };
  }

  private async editTicket(args: any) {
    const command: string[] = ['edit', args.id];
    if (args.title !== undefined) command.push('--title', args.title);
    if (args.description !== undefined) command.push('--description', args.description);
    if (args.priority !== undefined) command.push('--priority', args.priority);
    if (args.estimate !== undefined) command.push('--estimate', String(args.estimate));
    if (Array.isArray(args.addLabels)) {
      for (const l of args.addLabels) command.push('--add-label', l);
    }
    if (Array.isArray(args.removeLabels)) {
      for (const l of args.removeLabels) command.push('--remove-label', l);
    }
    if (args.clearLabels) command.push('--clear-labels');
    if (args.clearDescription) command.push('--clear-description');
    if (args.clearPriority) command.push('--clear-priority');
    if (args.clearEstimate) command.push('--clear-estimate');

    const output = await this.runCLI(command);
    return { content: [{ type: 'text', text: output }] };
  }

  private async assignTicket(args: any) {
    const command: string[] = ['user', 'assign', args.id];
    if (args.unassign) {
      command.push('--unassign');
    } else if (args.user) {
      command.push(args.user);
    } else {
      throw new Error('assign_ticket: provide "user" or set "unassign": true');
    }
    const output = await this.runCLI(command);
    return { content: [{ type: 'text', text: output }] };
  }

  private async setTicketSprint(args: any) {
    const command: string[] = ['sprint', 'set', args.id];
    if (args.unset) {
      command.push('--unset');
    } else if (args.sprintId) {
      command.push(args.sprintId);
    } else {
      throw new Error('set_ticket_sprint: provide "sprintId" or set "unset": true');
    }
    const output = await this.runCLI(command);
    return { content: [{ type: 'text', text: output }] };
  }

  private async editSprint(args: any) {
    const command: string[] = ['sprint', 'edit', args.id];
    if (args.name !== undefined) command.push('--name', args.name);
    if (args.description !== undefined) command.push('--description', args.description);
    if (args.goal !== undefined) command.push('--goal', args.goal);
    if (args.startDate !== undefined) command.push('--start-date', args.startDate);
    if (args.endDate !== undefined) command.push('--end-date', args.endDate);
    if (args.clearDescription) command.push('--clear-description');
    if (args.clearGoal) command.push('--clear-goal');
    if (args.clearStartDate) command.push('--clear-start-date');
    if (args.clearEndDate) command.push('--clear-end-date');
    const output = await this.runCLI(command);
    return { content: [{ type: 'text', text: output }] };
  }

  private async editUser(args: any) {
    const command: string[] = ['user', 'edit', args.ref];
    if (args.username !== undefined) command.push('--username', args.username);
    if (args.displayName !== undefined) command.push('--display-name', args.displayName);
    if (args.email !== undefined) command.push('--email', args.email);
    if (args.clearEmail) command.push('--clear-email');
    const output = await this.runCLI(command);
    return { content: [{ type: 'text', text: output }] };
  }

  private async deleteEntity(args: any) {
    const command = ['delete', args.id, '--force'];
    const output = await this.runCLI(command);
    return { content: [{ type: 'text', text: output }] };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

// Start the server if this file is run directly
const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  // Accept working directory as first argument, default to current directory
  const workingDir = process.argv[2] || process.cwd();
  const server = new TKXRMCPServer(workingDir);
  server.run().catch((error) => {
    console.error('Failed to start TKXR MCP server:', error);
    process.exit(1);
  });
}

export { TKXRMCPServer };