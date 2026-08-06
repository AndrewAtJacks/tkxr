import chalk from 'chalk';
import type minimist from 'minimist';
import { createStorage } from '../../core/storage.js';
import { notifier } from '../../core/notifier.js';

interface DeleteArgs extends minimist.ParsedArgs {
  force?: boolean;
  cascade?: boolean;
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

    // Deleting never touches a worktree (bug-MtPFb7dg), but the record is the
    // only thing that remembers the path — once it's gone the directory and
    // branch are orphaned and only `git worktree remove` can clean them up.
    // The web UI warns in its confirm dialog; this is the same warning for the
    // CLI (tas-IK2HcQWo).
    const wt = entity && typeof entity === 'object' ? (entity as any).worktree : null;
    if (wt?.path) {
      console.log(chalk.yellow(`  Worktree at ${wt.path} (branch ${wt.branch}) is left in place and tkxr stops tracking it.`));
      console.log(chalk.dim(`  Remove it first if you want tkxr to clean it up: tkxr worktree remove ${id}`));
    }

    // `--cascade` only means something for a sprint. Rejecting it elsewhere
    // beats silently ignoring a flag whose whole purpose is deleting more.
    const cascade = !!args.cascade;
    if (cascade && entityType !== 'sprints') {
      console.log(chalk.red(`--cascade only applies to sprints (${id} is a ${entityType.slice(0, -1)}).`));
      return;
    }

    // Show the blast radius before asking for confirmation — this is the one
    // delete in tkxr that destroys data rather than detaching it.
    if (entityType === 'sprints') {
      const allTickets = await storage.getAllTickets();
      const scopedTickets = allTickets.filter(t => t.sprint === id);
      const scopedEpics = (await storage.getEpics()).filter(e => e.sprint === id);
      if (cascade) {
        const counts = await storage.getCommentCounts();
        const commentCount = scopedTickets.reduce((sum, t) => sum + (counts[t.id] || 0), 0);
        console.log(chalk.red.bold('  CASCADE: this permanently deletes everything under the sprint.'));
        console.log(chalk.red(`    ${scopedTickets.length} ticket(s), ${scopedEpics.length} epic(s), ${commentCount} comment(s)`));
        const orphanWorktrees = [
          ...scopedTickets.filter(t => t.worktree),
          ...scopedEpics.filter(e => e.worktree),
        ];
        if (orphanWorktrees.length > 0) {
          console.log(chalk.yellow(`    ${orphanWorktrees.length} worktree(s) under this sprint stay on disk and stop being tracked:`));
          for (const o of orphanWorktrees) {
            console.log(chalk.dim(`      ${o.id}  ${(o as any).worktree.path}  (${(o as any).worktree.branch})`));
          }
        }
      } else {
        console.log(chalk.dim(`  ${scopedTickets.length} ticket(s) and ${scopedEpics.length} epic(s) move to the Unsorted workspace.`));
        console.log(chalk.dim('  Pass --cascade to delete them along with the sprint instead.'));
      }
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
    // Deleting an epic clears `epic` on every ticket that pointed at it, so we
    // need the swept list to re-broadcast those tickets to the board.
    let sweptTickets: Awaited<ReturnType<typeof storage.deleteEpic>>['sweptTickets'] = [];
    // Deleting a sprint detaches its epics too — they survive but become
    // sprintless, so they need re-broadcasting or an open board keeps drawing
    // them under a workspace that no longer exists.
    let sweptEpics: Awaited<ReturnType<typeof storage.deleteSprint>>['sweptEpics'] = [];
    // Cascade removes rather than detaches — these carry the rows that went so
    // every open board can drop them too.
    let deletedTickets: Awaited<ReturnType<typeof storage.deleteSprint>>['deletedTickets'] = [];
    let deletedEpics: Awaited<ReturnType<typeof storage.deleteSprint>>['deletedEpics'] = [];
    let deletedComments = 0;
    if (entityType === 'users') {
      const r = await storage.deleteUser(id);
      deleted = r.deleted;
      unassignedTickets = r.unassignedTickets;
    } else if (entityType === 'epics') {
      const r = await storage.deleteEpic(id);
      deleted = r.ok;
      sweptTickets = r.sweptTickets;
    } else if (entityType === 'sprints') {
      const r = await storage.deleteSprint(id, { cascade });
      deleted = r.ok;
      sweptTickets = r.sweptTickets;
      sweptEpics = r.sweptEpics;
      deletedTickets = r.deletedTickets;
      deletedEpics = r.deletedEpics;
      deletedComments = r.deletedComments;
    } else {
      deleted = await storage.deleteEntity(entityType, id);
    }

    if (deleted) {
      if (entityType === 'tasks' || entityType === 'bugs') {
        await notifier.notifyTicketDeleted(id);
      } else if (entityType === 'sprints') {
        await notifier.notifySprintDeleted(id);
        for (const e of deletedEpics) {
          await notifier.notifyEpicDeleted(e.id);
        }
        await notifier.notifyTicketsDeleted(deletedTickets.map(t => t.id));
        for (const e of sweptEpics) {
          await notifier.notifyEpicUpdated(e);
        }
        await notifier.notifyTicketsUpdated(sweptTickets);
        if (deletedTickets.length || deletedEpics.length) {
          console.log(chalk.dim(`  Deleted ${deletedTickets.length} ticket(s), ${deletedEpics.length} epic(s), ${deletedComments} comment(s).`));
        }
        if (sweptTickets.length && cascade) {
          // Tickets in *other* sprints that were filed under one of the deleted
          // epics — they survive, minus the epic tag.
          console.log(chalk.dim(`  Ungrouped ${sweptTickets.length} ticket(s) outside this sprint: ${sweptTickets.map(t => t.id).join(', ')}`));
        }
        if (sweptTickets.length && !cascade) {
          console.log(chalk.dim(`  Detached ${sweptTickets.length} ticket(s): ${sweptTickets.map(t => t.id).join(', ')}`));
          console.log(chalk.dim('  They moved to the Unsorted workspace — find them with: tkxr list --sprint none'));
        }
        if (sweptEpics.length) {
          console.log(chalk.dim(`  Detached ${sweptEpics.length} epic(s): ${sweptEpics.map(e => e.id).join(', ')}`));
        }
      } else if (entityType === 'epics') {
        await notifier.notifyEpicDeleted(id);
        for (const t of sweptTickets) {
          await notifier.notifyTicketUpdated(t);
        }
        if (sweptTickets.length) {
          console.log(chalk.dim(`  Ungrouped ${sweptTickets.length} ticket(s): ${sweptTickets.map(t => t.id).join(', ')}`));
          console.log(chalk.dim('  They stay in their sprint — find them with: tkxr list --epic none'));
        }
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