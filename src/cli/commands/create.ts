import chalk from 'chalk';
import type minimist from 'minimist';
import { FileStorage } from '../../core/storage.js';
import type { TicketType } from '../../core/types.js';

interface CreateArgs extends minimist.ParsedArgs {
  assignee?: string;
  sprint?: string;
  priority?: string;
  estimate?: string;
  description?: string;
}

export async function createTicket(args: CreateArgs): Promise<void> {
  const [, entityType, title] = args._;
  
  if (!entityType) {
    console.log(chalk.red('Error: Entity type is required'));
    console.log('Usage: tkxr create <type> <title> [options]');
    console.log('Types: task, bug, sprint, user');
    return;
  }
  
  if (!title) {
    console.log(chalk.red('Error: Title is required'));
    return;
  }

  const storage = new FileStorage();

  try {
    switch (entityType) {
      case 'task':
      case 'bug': {
        const ticket = await storage.createTicket(entityType as TicketType, title, {
          description: args.description,
          assignee: args.assignee,
          sprint: args.sprint,
          priority: args.priority as any,
          estimate: args.estimate ? parseInt(args.estimate) : undefined,
        });
        
        console.log(chalk.green(`✓ Created ${entityType}: ${ticket.id}`));
        console.log(`  Title: ${ticket.title}`);
        console.log(`  Status: ${ticket.status}`);
        if (ticket.assignee) console.log(`  Assignee: ${ticket.assignee}`);
        if (ticket.sprint) console.log(`  Sprint: ${ticket.sprint}`);
        if (ticket.priority) console.log(`  Priority: ${ticket.priority}`);
        break;
      }
      
      case 'sprint': {
        const sprint = await storage.createSprint(title, {
          description: args.description,
        });
        
        console.log(chalk.green(`✓ Created sprint: ${sprint.id}`));
        console.log(`  Name: ${sprint.name}`);
        console.log(`  Status: ${sprint.status}`);
        if (sprint.description) console.log(`  Description: ${sprint.description}`);
        break;
      }
      
      case 'user': {
        // For users, 'title' is the username
        const displayName = args.description || title;
        const user = await storage.createUser(title, displayName);
        
        console.log(chalk.green(`✓ Created user: ${user.id}`));
        console.log(`  Username: ${user.username}`);
        console.log(`  Display Name: ${user.displayName}`);
        break;
      }
      
      default:
        console.log(chalk.red(`Error: Unknown entity type "${entityType}"`));
        console.log('Valid types: task, bug, sprint, user');
    }
  } catch (error) {
    console.log(chalk.red(`Error creating ${entityType}: ${error instanceof Error ? error.message : 'Unknown error'}`));
  }
}