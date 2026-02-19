import chalk from 'chalk';
import type minimist from 'minimist';
import { FileStorage } from '../../core/storage.js';

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

  const storage = new FileStorage();

  try {
    // Try to find and load the entity first to show what we're deleting
    let entity = null;
    let entityType = '';

    // Check tasks
    entity = await storage.loadEntity('tasks', id);
    if (entity) entityType = 'tasks';
    
    // Check bugs if not found in tasks
    if (!entity) {
      entity = await storage.loadEntity('bugs', id);
      if (entity) entityType = 'bugs';
    }
    
    // Check sprints if not found in tickets
    if (!entity) {
      entity = await storage.loadEntity('sprints', id);
      if (entity) entityType = 'sprints';
    }
    
    // Check users if not found elsewhere
    if (!entity) {
      entity = await storage.loadEntity('users', id);
      if (entity) entityType = 'users';
    }

    if (!entity) {
      console.log(chalk.red(`Error: No entity found with ID "${id}"`));
      return;
    }

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
    const deleted = await storage.deleteEntity(entityType, id);
    
    if (deleted) {
      console.log(chalk.green(`✓ Deleted ${entityType.slice(0, -1)}: ${id}`));
    } else {
      console.log(chalk.red(`Error: Failed to delete ${id}`));
    }
  } catch (error) {
    console.log(chalk.red(`Error deleting ${id}: ${error instanceof Error ? error.message : 'Unknown error'}`));
  }
}