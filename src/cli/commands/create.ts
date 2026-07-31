import chalk from 'chalk';
import type minimist from 'minimist';
import { createStorage } from '../../core/storage.js';
import type { TicketType } from '../../core/types.js';
import { notifier } from '../../core/notifier.js';

interface CreateArgs extends minimist.ParsedArgs {
  assignee?: string;
  sprint?: string;
  epic?: string;
  color?: string;
  goal?: string;
  priority?: string;
  estimate?: string;
  description?: string;
}

export async function createTicket(args: CreateArgs): Promise<void> {
  const [, entityType, title] = args._;
  
  if (!entityType) {
    console.log(chalk.red('Error: Entity type is required'));
    console.log('Usage: tkxr create <type> <title> [options]');
    console.log('Types: task, bug, sprint, epic, user');
    return;
  }
  
  if (!title) {
    console.log(chalk.red('Error: Title is required'));
    return;
  }

  const storage = await createStorage();

  try {
    switch (entityType) {
      case 'task':
      case 'bug': {
        const ticket = await storage.createTicket(entityType as TicketType, title, {
          description: args.description,
          assignee: args.assignee,
          sprint: args.sprint,
          epic: args.epic,
          priority: args.priority as any,
          estimate: args.estimate ? parseInt(args.estimate) : undefined,
        });

        // Notify web UI
        await notifier.notifyTicketCreated(ticket);

        console.log(chalk.green(`✓ Created ${entityType}: ${ticket.id}`));
        console.log(`  Title: ${ticket.title}`);
        console.log(`  Status: ${ticket.status}`);
        if (ticket.assignee) console.log(`  Assignee: ${ticket.assignee}`);
        if (ticket.sprint) console.log(`  Sprint: ${ticket.sprint}`);
        if (ticket.epic) console.log(`  Epic: ${ticket.epic}`);
        if (ticket.priority) console.log(`  Priority: ${ticket.priority}`);
        break;
      }
      
      case 'sprint': {
        const sprint = await storage.createSprint(title, {
          description: args.description,
        });
        
        // Notify web UI
        await notifier.notifySprintCreated(sprint);
        
        console.log(chalk.green(`✓ Created sprint: ${sprint.id}`));
        console.log(`  Name: ${sprint.name}`);
        console.log(`  Status: ${sprint.status}`);
        if (sprint.description) console.log(`  Description: ${sprint.description}`);
        break;
      }
      
      case 'epic': {
        const epic = await storage.createEpic(title, {
          description: args.description,
          sprint: args.sprint,
          goal: args.goal,
          color: args.color,
        });

        // Notify web UI
        await notifier.notifyEpicCreated(epic);

        console.log(chalk.green(`✓ Created epic: ${epic.id}`));
        console.log(`  Name: ${epic.name}`);
        console.log(`  Status: ${epic.status}`);
        console.log(`  Sprint: ${epic.sprint || 'none'}`);
        if (epic.description) console.log(`  Description: ${epic.description}`);
        break;
      }

      case 'user': {
        // For users, 'title' is the username
        const displayName = args.description || title;
        const user = await storage.createUser(title, displayName);
        
        // Notify web UI
        await notifier.notifyUserCreated(user);
        
        console.log(chalk.green(`✓ Created user: ${user.id}`));
        console.log(`  Username: ${user.username}`);
        console.log(`  Display Name: ${user.displayName}`);
        break;
      }
      
      default:
        console.log(chalk.red(`Error: Unknown entity type "${entityType}"`));
        console.log('Valid types: task, bug, sprint, epic, user');
    }
  } catch (error) {
    console.log(chalk.red(`Error creating ${entityType}: ${error instanceof Error ? error.message : 'Unknown error'}`));
  }
}