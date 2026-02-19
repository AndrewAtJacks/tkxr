import chalk from 'chalk';
import type minimist from 'minimist';
import { FileStorage } from '../../core/storage.js';
import type { Ticket, Sprint, User, TicketType } from '../../core/types.js';

interface ListArgs extends minimist.ParsedArgs {
  status?: string;
  assignee?: string;
  sprint?: string;
  format?: 'table' | 'json';
  search?: string;
  s?: string; // alias for search
  'sort-by'?: 'title' | 'status' | 'priority' | 'created' | 'updated';
  order?: 'asc' | 'desc';
}

function formatTicket(ticket: Ticket): string {
  const statusColors = {
    todo: chalk.gray,
    progress: chalk.yellow,
    done: chalk.green,
  };
  
  const prioritySymbols = {
    low: '◦',
    medium: '●',
    high: '◉',
    critical: '🔴',
  };
  
  const statusColor = statusColors[ticket.status] || chalk.white;
  const prioritySymbol = ticket.priority ? prioritySymbols[ticket.priority] : '●';
  
  return `${chalk.blue(ticket.id)} ${statusColor(ticket.status.padEnd(8))} ${prioritySymbol} ${ticket.title}`;
}

function formatSprint(sprint: Sprint): string {
  const statusColors = {
    planning: chalk.gray,
    active: chalk.green,
    completed: chalk.blue,
  };
  
  const statusColor = statusColors[sprint.status] || chalk.white;
  return `${chalk.blue(sprint.id)} ${statusColor(sprint.status.padEnd(10))} ${sprint.name}`;
}

function formatUser(user: User): string {
  return `${chalk.blue(user.id)} ${chalk.green(user.username.padEnd(15))} ${user.displayName}`;
}

export async function listTickets(args: ListArgs): Promise<void> {
  const [, entityType] = args._;
  const storage = new FileStorage();

  try {
    switch (entityType) {
      case 'tasks':
      case 'task': {
        const tickets = await storage.getTicketsByType('task');
        const filteredTickets = sortTickets(filterTickets(tickets, args), args);
        
        if (filteredTickets.length === 0) {
          console.log(chalk.yellow('No tasks found'));
          return;
        }
        
        console.log(chalk.bold(`\n📋 Tasks (${filteredTickets.length})`));
        console.log(chalk.dim('ID'.padEnd(12) + 'STATUS'.padEnd(10) + 'PRI TITLE'));
        console.log(chalk.dim('─'.repeat(60)));
        
        filteredTickets.forEach(ticket => {
          console.log(formatTicket(ticket));
        });
        break;
      }
      
      case 'bugs':
      case 'bug': {
        const tickets = await storage.getTicketsByType('bug');
        const filteredTickets = sortTickets(filterTickets(tickets, args), args);
        
        if (filteredTickets.length === 0) {
          console.log(chalk.yellow('No bugs found'));
          return;
        }
        
        console.log(chalk.bold(`\n🐛 Bugs (${filteredTickets.length})`));
        console.log(chalk.dim('ID'.padEnd(12) + 'STATUS'.padEnd(10) + 'PRI TITLE'));
        console.log(chalk.dim('─'.repeat(60)));
        
        filteredTickets.forEach(ticket => {
          console.log(formatTicket(ticket));
        });
        break;
      }
      
      case 'sprints':
      case 'sprint': {
        const sprints = await storage.getSprints();
        
        if (sprints.length === 0) {
          console.log(chalk.yellow('No sprints found'));
          return;
        }
        
        console.log(chalk.bold(`\n🏃 Sprints (${sprints.length})`));
        console.log(chalk.dim('ID'.padEnd(12) + 'STATUS'.padEnd(12) + 'NAME'));
        console.log(chalk.dim('─'.repeat(50)));
        
        sprints.forEach(sprint => {
          console.log(formatSprint(sprint));
        });
        break;
      }
      
      case 'users':
      case 'user': {
        const users = await storage.getUsers();
        
        if (users.length === 0) {
          console.log(chalk.yellow('No users found'));
          return;
        }
        
        console.log(chalk.bold(`\n👥 Users (${users.length})`));
        console.log(chalk.dim('ID'.padEnd(12) + 'USERNAME'.padEnd(17) + 'DISPLAY NAME'));
        console.log(chalk.dim('─'.repeat(50)));
        
        users.forEach(user => {
          console.log(formatUser(user));
        });
        break;
      }
      
      default: {
        // List all tickets if no type specified
        const tasks = await storage.getTicketsByType('task');
        const bugs = await storage.getTicketsByType('bug');
        const allTickets = [...tasks, ...bugs];
        const filteredTickets = sortTickets(filterTickets(allTickets, args), args);
        
        if (filteredTickets.length === 0) {
          console.log(chalk.yellow('No tickets found'));
          return;
        }
        
        // Group by type
        const taskTickets = filteredTickets.filter(t => t.type === 'task');
        const bugTickets = filteredTickets.filter(t => t.type === 'bug');
        
        if (taskTickets.length > 0) {
          console.log(chalk.bold(`\n📋 Tasks (${taskTickets.length})`));
          console.log(chalk.dim('ID'.padEnd(12) + 'STATUS'.padEnd(10) + 'PRI TITLE'));
          console.log(chalk.dim('─'.repeat(60)));
          taskTickets.forEach(ticket => console.log(formatTicket(ticket)));
        }
        
        if (bugTickets.length > 0) {
          console.log(chalk.bold(`\n🐛 Bugs (${bugTickets.length})`));
          console.log(chalk.dim('ID'.padEnd(12) + 'STATUS'.padEnd(10) + 'PRI TITLE'));
          console.log(chalk.dim('─'.repeat(60)));
          bugTickets.forEach(ticket => console.log(formatTicket(ticket)));
        }
        
        break;
      }
    }
    
    console.log(); // Extra newline for spacing
  } catch (error) {
    console.log(chalk.red(`Error listing ${entityType || 'tickets'}: ${error instanceof Error ? error.message : 'Unknown error'}`));
  }
}

function filterTickets(tickets: Ticket[], args: ListArgs): Ticket[] {
  return tickets.filter(ticket => {
    if (args.status && ticket.status !== args.status) {
      return false;
    }
    if (args.assignee && ticket.assignee !== args.assignee) {
      return false;
    }
    if (args.sprint && ticket.sprint !== args.sprint) {
      return false;
    }
    
    // Search functionality
    const searchTerm = args.search || args.s;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const searchableText = `${ticket.title} ${ticket.description || ''} ${ticket.id}`.toLowerCase();
      if (!searchableText.includes(term)) {
        return false;
      }
    }
    
    return true;
  });
}

function sortTickets(tickets: Ticket[], args: ListArgs): Ticket[] {
  const sortBy = args['sort-by'] || 'updated';
  const order = args.order || 'desc';
  
  return tickets.sort((a, b) => {
    let compareValue = 0;
    
    switch (sortBy) {
      case 'title':
        compareValue = a.title.localeCompare(b.title);
        break;
      case 'status':
        const statusOrder = { todo: 0, progress: 1, done: 2 };
        compareValue = statusOrder[a.status] - statusOrder[b.status];
        break;
      case 'priority':
        const priorityOrder = { low: 0, medium: 1, high: 2, critical: 3 };
        const aPriority = a.priority || 'medium';
        const bPriority = b.priority || 'medium';
        compareValue = (priorityOrder[bPriority as keyof typeof priorityOrder] || 1) - (priorityOrder[aPriority as keyof typeof priorityOrder] || 1);
        break;
      case 'created':
        compareValue = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        break;
      case 'updated':
      default:
        compareValue = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
        break;
    }
    
    return order === 'desc' ? -compareValue : compareValue;
  });
}