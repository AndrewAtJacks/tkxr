import chalk from 'chalk';
import type minimist from 'minimist';
import { createStorage } from '../../core/storage.js';
import type { Ticket, Sprint, Epic, User, TicketType } from '../../core/types.js';

interface ListArgs extends minimist.ParsedArgs {
  status?: string;
  assignee?: string;
  /** Sprint id, or the literal `none` for tickets with no sprint. */
  sprint?: string;
  /** Epic id, or the literal `none` for tickets with no epic. */
  epic?: string;
  format?: 'table' | 'json';
  search?: string;
  s?: string; // alias for search
  'sort-by'?: 'title' | 'status' | 'priority' | 'created' | 'updated';
  order?: 'asc' | 'desc';
  verbose?: boolean;
  v?: boolean; // alias for verbose
}

function formatTicket(ticket: Ticket, verbose: boolean = false, users: User[] = [], sprints: Sprint[] = [], epics: Epic[] = []): string {
  const statusColors: Record<string, (s: string) => string> = {
    backlog: chalk.gray,
    progress: chalk.yellow,
    review: chalk.blue,
    blocked: chalk.red,
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
  
  let result = `${chalk.blue(ticket.id)} ${statusColor(ticket.status.padEnd(8))} ${prioritySymbol} ${ticket.title}`;
  
  if (verbose) {
    const assigneeDisplay = ticket.assignee 
      ? users.find(u => u.id === ticket.assignee)?.displayName || ticket.assignee 
      : '';
    const sprintDisplay = ticket.sprint
      ? sprints.find(s => s.id === ticket.sprint)?.name || ticket.sprint
      : '';
    const epicDisplay = ticket.epic
      ? epics.find(e => e.id === ticket.epic)?.name || ticket.epic
      : '';

    if (assigneeDisplay || sprintDisplay || epicDisplay) {
      const details = [];
      if (assigneeDisplay) details.push(chalk.dim(`@${assigneeDisplay}`));
      if (sprintDisplay) details.push(chalk.dim(`[${sprintDisplay}]`));
      if (epicDisplay) details.push(chalk.dim(`🎯${epicDisplay}`));
      result += ` ${details.join(' ')}`;
    }
  }
  
  return result;
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

function formatEpic(epic: Epic): string {
  const statusColors = {
    planning: chalk.gray,
    active: chalk.green,
    completed: chalk.blue,
  };

  const statusColor = statusColors[epic.status] || chalk.white;
  return `${chalk.blue(epic.id)} ${statusColor(epic.status.padEnd(10))} ${epic.name}`;
}

function formatUser(user: User): string {
  return `${chalk.blue(user.id)} ${chalk.green(user.username.padEnd(15))} ${user.displayName}`;
}

export async function listTickets(args: ListArgs): Promise<void> {
  const [, entityType] = args._;
  const storage = await createStorage();
  const verbose = args.verbose || args.v || false;

  // Load user, sprint and epic data if verbose mode is enabled
  let users: User[] = [];
  let sprints: Sprint[] = [];
  let epics: Epic[] = [];

  if (verbose) {
    try {
      users = await storage.getUsers();
      sprints = await storage.getSprints();
      epics = await storage.getEpics();
    } catch (error) {
      // Continue without verbose data if it fails to load
      console.log(chalk.dim('Warning: Could not load user/sprint/epic data for verbose mode'));
    }
  }

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
          console.log(formatTicket(ticket, verbose, users, sprints, epics));
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
          console.log(formatTicket(ticket, verbose, users, sprints, epics));
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
        
        sprints.forEach((sprint: any) => {
          console.log(formatSprint(sprint));
        });
        break;
      }
      
      case 'epics':
      case 'epic': {
        const allEpics = await storage.getEpics();

        if (allEpics.length === 0) {
          console.log(chalk.yellow('No epics found'));
          return;
        }

        console.log(chalk.bold(`\n🎯 Epics (${allEpics.length})`));
        console.log(chalk.dim('ID'.padEnd(12) + 'STATUS'.padEnd(12) + 'NAME'));
        console.log(chalk.dim('─'.repeat(50)));

        allEpics.forEach((epic: Epic) => {
          console.log(formatEpic(epic));
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
        
        users.forEach((user: any) => {
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
        
        const sortBy = args['sort-by'] || 'updated';
        
        // When sorting by priority, show unified list to maintain priority order
        if (sortBy === 'priority') {
          console.log(chalk.bold(`\n🎯 All Tickets by Priority (${filteredTickets.length})`));
          console.log(chalk.dim('ID'.padEnd(12) + 'STATUS'.padEnd(10) + 'PRI TITLE'));
          console.log(chalk.dim('─'.repeat(60)));
          filteredTickets.forEach(ticket => {
            console.log(formatTicket(ticket, verbose, users, sprints, epics));
          });
        } else {
          // Group by type for other sorts
          const taskTickets = filteredTickets.filter(t => t.type === 'task');
          const bugTickets = filteredTickets.filter(t => t.type === 'bug');
          
          if (taskTickets.length > 0) {
            console.log(chalk.bold(`\n📋 Tasks (${taskTickets.length})`));
            console.log(chalk.dim('ID'.padEnd(12) + 'STATUS'.padEnd(10) + 'PRI TITLE'));
            console.log(chalk.dim('─'.repeat(60)));
            taskTickets.forEach(ticket => console.log(formatTicket(ticket, verbose, users, sprints, epics)));
          }
          
          if (bugTickets.length > 0) {
            console.log(chalk.bold(`\n🐛 Bugs (${bugTickets.length})`));
            console.log(chalk.dim('ID'.padEnd(12) + 'STATUS'.padEnd(10) + 'PRI TITLE'));
            console.log(chalk.dim('─'.repeat(60)));
            bugTickets.forEach(ticket => console.log(formatTicket(ticket, verbose, users, sprints, epics)));
          }
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
    // `none` matches the unsorted bucket, mirroring the REST/MCP filters and
    // the board's Unsorted workspace.
    if (args.sprint) {
      const matches = args.sprint === 'none' ? !ticket.sprint : ticket.sprint === args.sprint;
      if (!matches) return false;
    }
    if (args.epic) {
      const matches = args.epic === 'none' ? !ticket.epic : ticket.epic === args.epic;
      if (!matches) return false;
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
        const statusOrder: Record<string, number> = { backlog: 0, progress: 1, review: 2, blocked: 3, done: 4 };
        compareValue = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);
        break;
      case 'priority':
        const priorityOrder = { low: 0, medium: 1, high: 2, critical: 3 };
        const aPriority = a.priority || 'medium';
        const bPriority = b.priority || 'medium';
        const aPriorityValue = priorityOrder[aPriority as keyof typeof priorityOrder] ?? 1;
        const bPriorityValue = priorityOrder[bPriority as keyof typeof priorityOrder] ?? 1;
        compareValue = aPriorityValue - bPriorityValue; // Low to high (ascending base)
        
        // If priorities are equal, sort bugs before tasks
        if (compareValue === 0) {
          if (a.type === 'bug' && b.type === 'task') {
            compareValue = -1; // bug comes first
          } else if (a.type === 'task' && b.type === 'bug') {
            compareValue = 1; // task comes second
          }
        }
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