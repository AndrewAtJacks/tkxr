import chalk from 'chalk';
import type minimist from 'minimist';
import { createStorage } from '../../core/storage.js';
import { notifier } from '../../core/notifier.js';
import { createWorktree, isGitRepo, listWorktrees, removeWorktree } from '../../core/worktree.js';

interface WorktreeArgs extends minimist.ParsedArgs {
  _: string[];
  path?: string;
  branch?: string;
  base?: string;
  force?: boolean;
  ['keep-branch']?: boolean;
  help?: boolean;
}

export async function manageWorktree(args: WorktreeArgs): Promise<void> {
  const [, sub, ticketId] = args._;

  if (args.help || !sub) {
    showHelp();
    return;
  }

  if (sub === 'list') {
    if (!(await isGitRepo())) {
      console.log(chalk.red('Not a git repository.'));
      return;
    }
    const worktrees = await listWorktrees();
    if (worktrees.length === 0) {
      console.log(chalk.dim('No worktrees.'));
      return;
    }
    for (const w of worktrees) {
      const suffix = w.bare ? chalk.yellow(' (bare)') : w.detached ? chalk.yellow(' (detached)') : '';
      console.log(`${chalk.blue(w.path)}${suffix}`);
      if (w.branch) console.log(`  branch: ${w.branch}`);
      if (w.head) console.log(`  head:   ${chalk.dim(w.head)}`);
    }
    return;
  }

  if (!ticketId) {
    console.log(chalk.red(`Error: ticket id required for "${sub}"`));
    showHelp();
    return;
  }

  const storage = await createStorage();
  const found = await storage.findTicket(ticketId);
  if (!found) {
    console.log(chalk.red(`Ticket "${ticketId}" not found`));
    return;
  }

  if (sub === 'create') {
    if (found.ticket.worktree) {
      console.log(chalk.red(`Ticket already has a worktree at ${found.ticket.worktree.path}`));
      console.log(chalk.dim(`Remove it first with: tkxr worktree remove ${ticketId}`));
      return;
    }
    if (!(await isGitRepo())) {
      console.log(chalk.red('Not a git repository.'));
      return;
    }
    try {
      const result = await createWorktree({
        ticketId,
        path: args.path,
        branch: args.branch,
        base: args.base,
      });
      const wt = { path: result.path, branch: result.branch, createdAt: new Date().toISOString() };
      const updated = await storage.updateTicket(ticketId, { worktree: wt });
      if (updated) await notifier.notifyTicketUpdated(updated);
      console.log(chalk.green(`✓ Worktree created`));
      console.log(`  Path:   ${chalk.blue(result.path)}`);
      console.log(`  Branch: ${chalk.blue(result.branch)}`);
      console.log(chalk.dim(`  cd "${result.path}"`));
    } catch (err) {
      console.log(chalk.red(`Failed: ${err instanceof Error ? err.message : String(err)}`));
    }
    return;
  }

  if (sub === 'remove') {
    const wt = found.ticket.worktree;
    if (!wt) {
      console.log(chalk.yellow(`Ticket "${ticketId}" has no worktree.`));
      return;
    }
    try {
      await removeWorktree({
        path: wt.path,
        branch: wt.branch,
        force: !!args.force,
        keepBranch: !!args['keep-branch'],
      });
      const updated = await storage.updateTicket(ticketId, { worktree: null });
      if (updated) await notifier.notifyTicketUpdated(updated);
      console.log(chalk.green(`✓ Worktree removed`));
      console.log(`  Path:   ${wt.path}`);
      console.log(`  Branch: ${wt.branch}${args['keep-branch'] ? chalk.dim(' (kept)') : ' (deleted)'}`);
    } catch (err) {
      console.log(chalk.red(`Failed: ${err instanceof Error ? err.message : String(err)}`));
    }
    return;
  }

  console.log(chalk.red(`Unknown subcommand: ${sub}`));
  showHelp();
}

function showHelp() {
  console.log(chalk.blue.bold('tkxr worktree — manage per-ticket git worktrees'));
  console.log();
  console.log(chalk.green('Usage:'));
  console.log('  tkxr worktree create <ticketId> [options]  Create a worktree + branch for a ticket');
  console.log('  tkxr worktree remove <ticketId> [options]  Remove the worktree');
  console.log('  tkxr worktree list                         List all git worktrees in this repo');
  console.log();
  console.log(chalk.green('Options (create):'));
  console.log('  --path <dir>          Override default path (../<repo>-worktrees/<ticketId>)');
  console.log('  --branch <name>       Override default branch (tkxr/<ticketId>)');
  console.log('  --base <ref>          Base branch/ref for the new branch (default HEAD)');
  console.log();
  console.log(chalk.green('Options (remove):'));
  console.log('  --force               Force remove even if the worktree has uncommitted changes');
  console.log('  --keep-branch         Do not delete the branch after removing the worktree');
  console.log();
  console.log(chalk.green('Env:'));
  console.log('  TKXR_WORKTREE_ROOT    Override the base directory for worktree paths');
}
