import chalk from 'chalk';
import type minimist from 'minimist';
import { FileStorage } from '../../core/storage.js';
import type { TicketStatus } from '../../core/types.js';

interface StatusArgs extends minimist.ParsedArgs {}

const VALID_STATUSES: TicketStatus[] = ['todo', 'progress', 'done'];

export async function updateTicketStatus(args: StatusArgs): Promise<void> {
  const [, id, status] = args._;
  
  if (!id) {
    console.log(chalk.red('Error: Ticket ID is required'));
    console.log('Usage: tkxr status <id> <status>');
    console.log(`Valid statuses: ${VALID_STATUSES.join(', ')}`);
    return;
  }
  
  if (!status) {
    console.log(chalk.red('Error: Status is required'));
    console.log(`Valid statuses: ${VALID_STATUSES.join(', ')}`);
    return;
  }
  
  if (!VALID_STATUSES.includes(status as TicketStatus)) {
    console.log(chalk.red(`Error: Invalid status "${status}"`));
    console.log(`Valid statuses: ${VALID_STATUSES.join(', ')}`);
    return;
  }

  const storage = new FileStorage();

  try {
    const updatedTicket = await storage.updateTicketStatus(id, status as TicketStatus);
    
    if (!updatedTicket) {
      console.log(chalk.red(`Error: No ticket found with ID "${id}"`));
      return;
    }

    const statusColors = {
      todo: chalk.gray,
      progress: chalk.yellow,
      done: chalk.green,
    };
    
    const statusColor = statusColors[updatedTicket.status];
    
    console.log(chalk.green(`✓ Updated ticket status`));
    console.log(`  ID: ${chalk.blue(updatedTicket.id)}`);
    console.log(`  Title: ${updatedTicket.title}`);
    console.log(`  Status: ${statusColor(updatedTicket.status)}`);
    console.log(`  Updated: ${updatedTicket.updatedAt.toLocaleString()}`);
  } catch (error) {
    console.log(chalk.red(`Error updating ticket status: ${error instanceof Error ? error.message : 'Unknown error'}`));
  }
}