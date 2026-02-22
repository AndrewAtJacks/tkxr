import chalk from 'chalk';
import type minimist from 'minimist';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { promises as fs, unlinkSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createStorage } from '../../core/storage.js';
import { notifier } from '../../core/notifier.js';

interface ServeArgs extends minimist.ParsedArgs {
  port?: number;
  host?: string;
}

export async function startServer(args: ServeArgs): Promise<void> {
  const port = args.port || 8080;
  const host = args.host || 'localhost';
  
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });
  
  const storage = await createStorage();

  // Ensure the process is running from the appropriate `dist` directory so relative
  // paths to `package.json` and the `web` assets resolve correctly.
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    // Candidate: dist directory in the project root and adjacent to this module when installed
    const projectDist = path.join(process.cwd(), 'dist');
    const moduleDist = path.join(__dirname, '..', '..', '..', 'dist');

    // Prefer the project's dist (development) first, fall back to module dist (installed)
    try {
      await fs.access(projectDist);
      process.chdir(projectDist);
      console.debug('Changed cwd to project dist:', projectDist);
    } catch (errProject) {
      try {
        await fs.access(moduleDist);
        process.chdir(moduleDist);
        console.debug('Changed cwd to module dist:', moduleDist);
      } catch (errModule) {
        // No dist found; continue using existing cwd
      }
    }
  } catch (err) {
    // Non-fatal; best effort only
    console.debug('Could not change cwd to dist:', err);
  }

  // Read version from package.json in current working directory first (so project dist is preferred)
  let version = '1.0.0'; // fallback
  try {
    const cwdPkg = path.join(process.cwd(), 'package.json');
    try {
      const pkgContent = await fs.readFile(cwdPkg, 'utf8');
      const pkg = JSON.parse(pkgContent);
      version = pkg.version || version;
    } catch (errCwdPkg) {
      // Fallback: attempt to read package.json relative to this module (installed package)
      try {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const pkgPath = path.join(__dirname, '..', '..', '..', 'package.json');
        const pkgContent = await fs.readFile(pkgPath, 'utf8');
        const pkg = JSON.parse(pkgContent);
        version = pkg.version || version;
      } catch (error) {
        console.debug('Could not read package.json version from module or cwd:', error);
      }
    }
  } catch (error) {
    console.debug('Could not read package.json version:', error);
  }

  // Update notifier URL for this server instance
  const serverUrl = `http://${host}:${port}`;
  notifier.setServerUrl(serverUrl);
  
  // Save server config for other CLI commands to use
  try {
    const configPath = path.join(process.cwd(), '.env.tkxr');
    const envContent = `TKXR_HOST=${host}\nTKXR_PORT=${port}\n`;
    await fs.writeFile(configPath, envContent, 'utf8');
  } catch (error) {
    // Don't fail if we can't write config
    console.debug('Could not save .env.tkxr config:', error);
  }

  // Middleware
  app.use(express.json());
  // Serve static assets from the `web` folder inside `dist` (we may have chdir'd to dist)
  app.use(express.static(path.join(process.cwd(), 'web')));

  // API Routes
  app.get('/api/tickets', async (req, res) => {
    try {
      // Reload data from disk to ensure we have the latest changes
      await storage.loadProject();
      const tickets = await storage.getAllTickets();
      res.json(tickets);
    } catch (error) {
      res.status(500).json({ error: 'Failed to load tickets' });
    }
  });

  app.get('/api/tickets/:type', async (req, res) => {
    try {
      const { type } = req.params;
      if (type !== 'task' && type !== 'bug') {
        return res.status(400).json({ error: 'Invalid ticket type' });
      }
      const tickets = await storage.getTicketsByType(type);
      res.json(tickets);
    } catch (error) {
      res.status(500).json({ error: 'Failed to load tickets' });
    }
  });

  app.get('/api/sprints', async (req, res) => {
    try {      // Reload data from disk to ensure we have the latest changes
      await storage.loadProject();      const sprints = await storage.getSprints();
      res.json(sprints);
    } catch (error) {
      res.status(500).json({ error: 'Failed to load sprints' });
    }
  });

  app.get('/api/users', async (req, res) => {
    try {      // Reload data from disk to ensure we have the latest changes
      await storage.loadProject();      const users = await storage.getUsers();
      res.json(users);
    } catch (error) {
      res.status(500).json({ error: 'Failed to load users' });
    }
  });

  // Serve server configuration for dynamic client discovery
  app.get('/api/config', async (req, res) => {
    try {
      res.json({
        host: 'localhost',
        port: port,
        url: `http://localhost:${port}`,
        version: version
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get server config' });
    }
  });

  app.post('/api/tickets', async (req, res) => {
    try {
      const { type, title, ...options } = req.body;
      
      if (!type || !title) {
        return res.status(400).json({ error: 'Type and title are required' });
      }
      
      if (type !== 'task' && type !== 'bug') {
        return res.status(400).json({ error: 'Invalid ticket type' });
      }

      const ticket = await storage.createTicket(type, title, options);
      
      // Broadcast to WebSocket clients
      broadcast(wss, { 
        type: 'ticket_created', 
        data: ticket 
      });
      
      res.json(ticket);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create ticket' });
    }
  });

  app.put('/api/tickets/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      
      // Update ticket using the simplified interface
      const updatedTicket = await storage.updateTicket(id, updates);

      if (!updatedTicket) {
        return res.status(404).json({ error: 'Ticket not found' });
      }
      
      // Broadcast to WebSocket clients
      broadcast(wss, { 
        type: 'ticket_updated', 
        data: updatedTicket 
      });
      
      res.json(updatedTicket);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update ticket' });
    }
  });

  app.delete('/api/tickets/:id', async (req, res) => {
    try {
      const { id } = req.params;
      
      // First, delete all comments associated with this ticket
      const comments = await storage.getComments(id);
      for (const comment of comments) {
        await storage.deleteComment(comment.id);
      }
      
      // Try to delete from tasks first, then bugs
      let deleted = await storage.deleteEntity('tasks', id);
      if (!deleted) {
        deleted = await storage.deleteEntity('bugs', id);
      }

      if (!deleted) {
        return res.status(404).json({ error: 'Ticket not found' });
      }

      // Broadcast to WebSocket clients
      broadcast(wss, { 
        type: 'ticket_deleted', 
        data: { id } 
      });
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete ticket' });
    }
  });

  app.post('/api/users', async (req, res) => {
    try {
      const { username, displayName, email } = req.body;
      
      if (!username || !displayName) {
        return res.status(400).json({ error: 'Username and display name are required' });
      }

      const user = await storage.createUser(username, displayName, { email });
      res.json(user);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create user' });
    }
  });

  app.delete('/api/users/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteEntity('users', id);

      if (!deleted) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete user' });
    }
  });

  // Comments API
  app.get('/api/tickets/:ticketId/comments', async (req, res) => {
    try {
      // Reload data from disk to ensure we have the latest changes
      await storage.loadProject();
      const { ticketId } = req.params;
      const comments = await storage.getComments(ticketId);
      res.json(comments);
    } catch (error) {
      res.status(500).json({ error: 'Failed to load comments' });
    }
  });

  app.post('/api/tickets/:ticketId/comments', async (req, res) => {
    try {
      const { ticketId } = req.params;
      const { content, author } = req.body;
      
      if (!content || !content.trim()) {
        return res.status(400).json({ error: 'Comment content is required' });
      }

      if (!author) {
        return res.status(400).json({ error: 'Comment author is required' });
      }

      const comment = await storage.createComment(ticketId, author, content.trim());
      
      // Broadcast to WebSocket clients
      broadcast(wss, { 
        type: 'comment_created', 
        data: comment 
      });
      
      res.json(comment);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create comment' });
    }
  });

  app.delete('/api/comments/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteComment(id);

      if (!deleted) {
        return res.status(404).json({ error: 'Comment not found' });
      }

      // Broadcast to WebSocket clients
      broadcast(wss, { 
        type: 'comment_deleted', 
        data: { id } 
      });

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete comment' });
    }
  });

  app.post('/api/sprints', async (req, res) => {
    try {
      const { name, description, goal } = req.body;
      
      if (!name) {
        return res.status(400).json({ error: 'Sprint name is required' });
      }

      const sprint = await storage.createSprint(name, { description, goal });
      res.json(sprint);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create sprint' });
    }
  });

  app.delete('/api/sprints/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteEntity('sprints', id);

      if (!deleted) {
        return res.status(404).json({ error: 'Sprint not found' });
      }

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete sprint' });
    }
  });

  app.put('/api/sprints/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, goal } = req.body;
      
      if (!name) {
        return res.status(400).json({ error: 'Sprint name is required' });
      }

      const sprint = await storage.updateSprint(id, { name, description, goal });
      
      if (!sprint) {
        return res.status(404).json({ error: 'Sprint not found' });
      }

      res.json(sprint);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update sprint' });
    }
  });

  app.put('/api/users/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { username, displayName, email } = req.body;
      
      if (!username || !displayName) {
        return res.status(400).json({ error: 'Username and display name are required' });
      }

      const user = await storage.updateUser(id, { username, displayName, email });
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json(user);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update user' });
    }
  });
  app.put('/api/sprints/:id/status', async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      
      if (!['planning', 'active', 'completed'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status. Must be planning, active, or completed' });
      }

      const sprint = await storage.updateSprintStatus(id, status);
      
      if (!sprint) {
        return res.status(404).json({ error: 'Sprint not found' });
      }

      res.json(sprint);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update sprint status' });
    }
  });

  app.put('/api/tickets/:id/status', async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      
      if (!status) {
        return res.status(400).json({ error: 'Status is required' });
      }

      const ticket = await storage.updateTicketStatus(id, status);
      
      if (!ticket) {
        return res.status(404).json({ error: 'Ticket not found' });
      }

      // Broadcast to WebSocket clients
      broadcast(wss, { 
        type: 'ticket_updated', 
        data: ticket 
      });
      
      res.json(ticket);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update ticket' });
    }
  });

  // CLI Notification endpoints - allow CLI to notify web server of changes
  app.post('/api/cli-notifications/ticket-created', async (req, res) => {
    try {
      const ticket = req.body;
      
      // Broadcast to WebSocket clients
      broadcast(wss, { 
        type: 'ticket_created', 
        data: ticket 
      });
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to process notification' });
    }
  });

  app.post('/api/cli-notifications/ticket-updated', async (req, res) => {
    try {
      const ticket = req.body;
      
      // Broadcast to WebSocket clients
      broadcast(wss, { 
        type: 'ticket_updated', 
        data: ticket 
      });
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to process notification' });
    }
  });

  app.post('/api/cli-notifications/ticket-deleted', async (req, res) => {
    try {
      const { id } = req.body;
      
      // Broadcast to WebSocket clients
      broadcast(wss, { 
        type: 'ticket_deleted', 
        data: { id } 
      });
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to process notification' });
    }
  });

  app.post('/api/cli-notifications/sprint-created', async (req, res) => {
    try {
      const sprint = req.body;
      
      // Broadcast to WebSocket clients
      broadcast(wss, { 
        type: 'sprint_created', 
        data: sprint 
      });
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to process notification' });
    }
  });

  app.post('/api/cli-notifications/sprint-updated', async (req, res) => {
    try {
      const sprint = req.body;
      
      // Broadcast to WebSocket clients
      broadcast(wss, { 
        type: 'sprint_updated', 
        data: sprint 
      });
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to process notification' });
    }
  });

  app.post('/api/cli-notifications/user-created', async (req, res) => {
    try {
      const user = req.body;
      
      // Broadcast to WebSocket clients
      broadcast(wss, { 
        type: 'user_created', 
        data: user 
      });
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to process notification' });
    }
  });

  app.post('/api/cli-notifications/comment-created', async (req, res) => {
    try {
      const comment = req.body;
      
      // Broadcast to WebSocket clients
      broadcast(wss, { 
        type: 'comment_created', 
        data: comment 
      });
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to process notification' });
    }
  });

  app.post('/api/cli-notifications/comment-deleted', async (req, res) => {
    try {
      const { id, ticketId } = req.body;
      
      // Broadcast to WebSocket clients
      broadcast(wss, { 
        type: 'comment_deleted', 
        data: { id, ticketId } 
      });
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to process notification' });
    }
  });

  // Serve web app for all other routes
  app.get('*', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'web', 'index.html'));
  });

  // WebSocket connection handling
  wss.on('connection', (ws) => {
    console.log(chalk.dim('WebSocket client connected'));
    
    ws.on('close', () => {
      console.log(chalk.dim('WebSocket client disconnected'));
    });
  });

  // Start server
  server.listen(port, host, () => {
    console.log(chalk.green('🚀 tkxr server started'));
    console.log(`   Local:   http://${host}:${port}`);
    console.log(`   API:     http://${host}:${port}/api`);
    console.log();
    console.log(chalk.dim('Press Ctrl+C to stop'));
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log(chalk.yellow('\n⏹️  Shutting down server...'));
    
    // Clean up server config file
    try {
      const configPath = path.join(process.cwd(), '.env.tkxr');
      unlinkSync(configPath);
    } catch (error) {
      // Ignore cleanup errors
    }
    
    server.close(() => {
      console.log(chalk.green('Server stopped'));
      process.exit(0);
    });
  });
}

function broadcast(wss: WebSocketServer, message: any): void {
  const data = JSON.stringify(message);
  wss.clients.forEach(client => {
    if (client.readyState === client.OPEN) {
      client.send(data);
    }
  });
}