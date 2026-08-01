import chalk from 'chalk';
import type minimist from 'minimist';
import { createStorage } from '../../core/storage.js';
import type { TicketStatus } from '../../core/types.js';
import { notifier } from '../../core/notifier.js';
import { getRepoRoot, isBranchMerged, isGitRepo } from '../../core/worktree.js';

interface StatusArgs extends minimist.ParsedArgs {}

const VALID_STATUSES: TicketStatus[] = ['backlog', 'progress', 'review', 'blocked', 'done'];

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

  const storage = await createStorage();

  try {
    const updatedTicket = await storage.updateTicketStatus(id, status as TicketStatus);
    
    if (!updatedTicket) {
      console.log(chalk.red(`Error: No ticket found with ID "${id}"`));
      return;
    }

    // Notify web UI
    await notifier.notifyTicketUpdated(updatedTicket);

    const statusColors: Record<TicketStatus, (s: string) => string> = {
      backlog: chalk.gray,
      progress: chalk.yellow,
      review: chalk.blue,
      blocked: chalk.red,
      done: chalk.green,
    };

    const statusColor = statusColors[updatedTicket.status] || chalk.white;
    
    console.log(chalk.green(`✓ Updated ticket status`));
    console.log(`  ID: ${chalk.blue(updatedTicket.id)}`);
    console.log(`  Title: ${updatedTicket.title}`);
    console.log(`  Status: ${statusColor(updatedTicket.status)}`);
    console.log(`  Updated: ${updatedTicket.updatedAt.toLocaleString()}`);

    // `done` used to delete the worktree outright. It now just points at the
    // command, and says whether the branch has landed so you know if removing
    // it would drop anything.
    if (updatedTicket.status === 'done' && updatedTicket.worktree) {
      const wt = updatedTicket.worktree;
      console.log();
      try {
        const merged = (await isGitRepo())
          && (await isBranchMerged(wt.branch, await getRepoRoot()));
        console.log(chalk.dim(merged
          ? `Worktree still open at ${wt.path} (${wt.branch} is merged).`
          : `Worktree still open at ${wt.path} (${wt.branch} has unmerged commits).`));
      } catch {
        console.log(chalk.dim(`Worktree still open at ${wt.path}.`));
      }
      console.log(chalk.dim(`Close it with: tkxr worktree remove ${updatedTicket.id}`));
    }
  } catch (error) {
    console.log(chalk.red(`Error updating ticket status: ${error instanceof Error ? error.message : 'Unknown error'}`));
  }
}