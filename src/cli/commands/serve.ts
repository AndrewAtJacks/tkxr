import chalk from 'chalk';
import type minimist from 'minimist';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import path from 'path';
import { FileStorage } from '../../core/storage.js';

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
  
  const storage = new FileStorage();

  // Middleware
  app.use(express.json());
  app.use(express.static(path.join(process.cwd(), 'dist', 'web')));

  // API Routes
  app.get('/api/tickets', async (req, res) => {
    try {
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
    try {
      const sprints = await storage.getSprints();
      res.json(sprints);
    } catch (error) {
      res.status(500).json({ error: 'Failed to load sprints' });
    }
  });

  app.get('/api/users', async (req, res) => {
    try {
      const users = await storage.getUsers();
      res.json(users);
    } catch (error) {
      res.status(500).json({ error: 'Failed to load users' });
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
      
      // Load existing ticket
      let ticket = await storage.loadEntity('tasks', id);
      let entityType = 'tasks';
      
      if (!ticket) {
        ticket = await storage.loadEntity('bugs', id);
        entityType = 'bugs';
      }

      if (!ticket) {
        return res.status(404).json({ error: 'Ticket not found' });
      }

      // Update ticket
      const updatedTicket = {
        ...ticket,
        ...updates,
        updatedAt: new Date()
      };

      await storage.saveEntity(entityType, updatedTicket);
      
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

  // Serve web app for all other routes
  app.get('*', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'dist', 'web', 'index.html'));
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