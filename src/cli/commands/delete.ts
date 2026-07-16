import chalk from 'chalk';
import type minimist from 'minimist';
import { createStorage } from '../../core/storage.js';
import { notifier } from '../../core/notifier.js';

interface DeleteArgs extends minimist.ParsedArgs {
  force?: boolean;
}

export async function deleteTicket(args: DeleteArgs): Promise<void> {
  const [, id] = args._;
  
  if (!id) {
    console.log(chalk.red('Error: Ticket ID is required'));
    console.log('Usage: tkxr delete <id>');
    return;
  }

  const storage = await createStorage();

  try {
    // Try to find and load the entity first to show what we're deleting
    const result = await storage.findEntity(id);
    
    if (!result) {
      console.log(chalk.red(`Error: No entity found with ID "${id}"`));
      return;
    }

    const { entity, type: entityType } = result;

    // Show what will be deleted
    console.log(chalk.yellow(`About to delete ${entityType.slice(0, -1)}: ${id}`));
    if (entity && typeof entity === 'object' && 'title' in entity) {
      console.log(`  Title: ${(entity as any).title}`);
    } else if (entity && typeof entity === 'object' && 'name' in entity) {
      console.log(`  Name: ${(entity as any).name}`);
    } else if (entity && typeof entity === 'object' && 'username' in entity) {
      console.log(`  Username: ${(entity as any).username}`);
    }

    // Confirm deletion unless --force is specified
    if (!args.force) {
      console.log(chalk.red('Use --force to confirm deletion'));
      return;
    }

    // Perform deletion
    if (entityType === 'tasks' || entityType === 'bugs') {
      // For tickets, first delete all associated comments
      const comments = await storage.getComments(id);
      for (const comment of comments) {
        await storage.deleteComment(comment.id);
      }
      console.log(chalk.dim(`  Deleted ${comments.length} associated comment(s)...`));
    }
    
    // Users get a dedicated path so we can also fan-out ticket_updated notifications
    // for every ticket that was auto-unassigned by the delete.
    let deleted = false;
    let unassignedTickets: Awaited<ReturnType<typeof storage.deleteUser>>['unassignedTickets'] = [];
    if (entityType === 'users') {
      const r = await storage.deleteUser(id);
      deleted = r.deleted;
      unassignedTickets = r.unassignedTickets;
    } else {
      deleted = await storage.deleteEntity(entityType, id);
    }

    if (deleted) {
      if (entityType === 'tasks' || entityType === 'bugs') {
        await notifier.notifyTicketDeleted(id);
      } else if (entityType === 'sprints') {
        await notifier.notifySprintDeleted(id);
      } else if (entityType === 'users') {
        await notifier.notifyUserDeleted(id);
        for (const t of unassignedTickets) {
          await notifier.notifyTicketUpdated(t);
        }
        if (unassignedTickets.length) {
          console.log(chalk.dim(`  Unassigned ${unassignedTickets.length} ticket(s): ${unassignedTickets.map(t => t.id).join(', ')}`));
        }
      } else if (entityType === 'comments') {
        // Comment delete needs ticketId — we don't have it in this generic path.
        // The dedicated `comments --delete` command handles notification with ticketId.
      }

      console.log(chalk.green(`✓ Deleted ${entityType.slice(0, -1)}: ${id}`));
    } else {
      console.log(chalk.red(`Error: Failed to delete ${id}`));
    }
  } catch (error) {
    console.log(chalk.red(`Error deleting ${id}: ${error instanceof Error ? error.message : 'Unknown error'}`));
  }
}