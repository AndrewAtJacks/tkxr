#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  InitializeRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { fileURLToPath } from 'url';
import { createStorage } from '../core/storage.js';
import { notifier } from '../core/notifier.js';
import { SERVER_INSTRUCTIONS, TOOL_MAP, TOOLS, type ToolContext } from './tools.js';

async function main() {
  const storage = await createStorage();

  const ctx: ToolContext = {
    storage,
    broadcast: (ev) => {
      switch (ev.type) {
        case 'ticket_created': notifier.notifyTicketCreated(ev.data); break;
        case 'ticket_updated': notifier.notifyTicketUpdated(ev.data); break;
        case 'ticket_deleted': notifier.notifyTicketDeleted(ev.data.id); break;
        case 'sprint_created': notifier.notifySprintCreated(ev.data); break;
        case 'sprint_updated': notifier.notifySprintUpdated(ev.data); break;
        case 'sprint_deleted': notifier.notifySprintDeleted(ev.data.id); break;
        case 'user_created': notifier.notifyUserCreated(ev.data); break;
        case 'user_updated': notifier.notifyUserUpdated(ev.data); break;
        case 'user_deleted': notifier.notifyUserDeleted(ev.data.id); break;
        case 'comment_created': notifier.notifyCommentCreated(ev.data); break;
        case 'comment_deleted': notifier.notifyCommentDeleted(ev.data.id, ev.data.ticketId); break;
      }
    },
  };

  const server = new Server(
    { name: 'tkxr-mcp', version: '1.2.0' },
    {
      capabilities: { tools: {} },
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  server.setRequestHandler(InitializeRequestSchema, async () => ({
    protocolVersion: '2024-11-05',
    capabilities: { tools: {} },
    serverInfo: { name: 'tkxr-mcp', version: '1.2.0' },
    instructions: SERVER_INSTRUCTIONS,
  }));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<any> => {
    const { name, arguments: args } = request.params;
    const tool = TOOL_MAP[name];
    if (!tool) {
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
    try {
      return await tool.handler(args || {}, ctx);
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error executing ${name}: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((error) => {
    console.error('Failed to start tkxr MCP stdio server:', error);
    process.exit(1);
  });
}

export { main as runMcpStdio };
