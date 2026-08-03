import chalk from 'chalk';
import type minimist from 'minimist';
import { createStorage } from '../../core/storage.js';
import { notifier } from '../../core/notifier.js';
import { BranchKeptError, createEpicWorktree, createSprintWorktree, createWorktree, isGitRepo, listWorktrees, removeWorktree, resolveTicketBase } from '../../core/worktree.js';

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
    console.log(chalk.red(`Error: id required for "${sub}"`));
    showHelp();
    return;
  }

  const storage = await createStorage();

  if (ticketId.startsWith('spr-')) {
    return sprintOp(sub, ticketId, args, storage);
  }
  if (ticketId.startsWith('epi-')) {
    return epicOp(sub, ticketId, args, storage);
  }

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
      let effectiveBase = args.base;
      if (!effectiveBase) {
        const epic = found.ticket.epic
          ? (await storage.getEpics()).find(e => e.id === found.ticket.epic)
          : null;
        const sprint = found.ticket.sprint
          ? (await storage.getSprints()).find(s => s.id === found.ticket.sprint)
          : null;
        effectiveBase = resolveTicketBase(epic, sprint) || undefined;
      }
      const result = await createWorktree({
        ticketId,
        path: args.path,
        branch: args.branch,
        base: effectiveBase,
      });
      const wt = { path: result.path, branch: result.branch, createdAt: new Date().toISOString() };
      const updated = await storage.updateTicket(ticketId, { worktree: wt });
      if (updated) await notifier.notifyTicketUpdated(updated);
      console.log(chalk.green(`✓ Worktree created`));
      console.log(`  Path:   ${chalk.blue(result.path)}`);
      console.log(`  Branch: ${chalk.blue(result.branch)}${effectiveBase ? chalk.dim(`  (based on ${effectiveBase})`) : ''}`);
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
      // The worktree came off cleanly; only the branch delete was declined
      // because it still holds unmerged commits. That's the safe outcome.
      if (err instanceof BranchKeptError) {
        const updated = await storage.updateTicket(ticketId, { worktree: null });
        if (updated) await notifier.notifyTicketUpdated(updated);
        console.log(chalk.green(`✓ Worktree removed`));
        console.log(`  Path:   ${wt.path}`);
        console.log(`  Branch: ${wt.branch}${chalk.yellow(' (kept — unmerged commits)')}`);
        console.log(chalk.dim(`  Delete it anyway with: git branch -D ${wt.branch}`));
        return;
      }
      console.log(chalk.red(`Failed: ${err instanceof Error ? err.message : String(err)}`));
    }
    return;
  }

  console.log(chalk.red(`Unknown subcommand: ${sub}`));
  showHelp();
}

async function epicOp(sub: string, epicId: string, args: WorktreeArgs, storage: Awaited<ReturnType<typeof createStorage>>): Promise<void> {
  const epics = await storage.getEpics();
  const epic = epics.find(e => e.id === epicId);
  if (!epic) {
    console.log(chalk.red(`Epic "${epicId}" not found`));
    return;
  }

  if (sub === 'create') {
    if (epic.worktree) {
      console.log(chalk.red(`Epic already has a worktree at ${epic.worktree.path}`));
      console.log(chalk.dim(`Remove it first with: tkxr worktree remove ${epicId}`));
      return;
    }
    if (!(await isGitRepo())) {
      console.log(chalk.red('Not a git repository.'));
      return;
    }
    try {
      // An epic-less base default: the epic's sprint branch when the workspace
      // has one, otherwise HEAD. Mirrors how a ticket nests under its epic.
      let effectiveBase = args.base;
      if (!effectiveBase && epic.sprint) {
        const sprint = (await storage.getSprints()).find(s => s.id === epic.sprint);
        if (sprint?.worktree) effectiveBase = sprint.worktree.branch;
      }
      const result = await createEpicWorktree({
        epicId,
        path: args.path,
        branch: args.branch,
        base: effectiveBase,
      });
      const wt = { path: result.path, branch: result.branch, createdAt: new Date().toISOString() };
      const updated = await storage.updateEpic(epicId, { worktree: wt });
      if (updated) await notifier.notifyEpicUpdated(updated);
      console.log(chalk.green(`✓ Epic worktree created`));
      console.log(`  Path:   ${chalk.blue(result.path)}`);
      console.log(`  Branch: ${chalk.blue(result.branch)}${effectiveBase ? chalk.dim(`  (based on ${effectiveBase})`) : ''}`);
      console.log(chalk.dim(`  cd "${result.path}"`));
      console.log(chalk.dim(`  Ticket worktrees in this epic will now branch off ${result.branch}.`));
    } catch (err) {
      console.log(chalk.red(`Failed: ${err instanceof Error ? err.message : String(err)}`));
    }
    return;
  }

  if (sub === 'remove') {
    const wt = epic.worktree;
    if (!wt) {
      console.log(chalk.yellow(`Epic "${epicId}" has no worktree.`));
      return;
    }
    try {
      await removeWorktree({
        path: wt.path,
        branch: wt.branch,
        force: !!args.force,
        keepBranch: !!args['keep-branch'],
      });
      const updated = await storage.updateEpic(epicId, { worktree: null });
      if (updated) await notifier.notifyEpicUpdated(updated);
      console.log(chalk.green(`✓ Epic worktree removed`));
      console.log(`  Path:   ${wt.path}`);
      console.log(`  Branch: ${wt.branch}${args['keep-branch'] ? chalk.dim(' (kept)') : ' (deleted)'}`);
    } catch (err) {
      if (err instanceof BranchKeptError) {
        const updated = await storage.updateEpic(epicId, { worktree: null });
        if (updated) await notifier.notifyEpicUpdated(updated);
        console.log(chalk.green(`✓ Epic worktree removed`));
        console.log(`  Path:   ${wt.path}`);
        console.log(`  Branch: ${wt.branch}${chalk.yellow(' (kept — unmerged commits)')}`);
        console.log(chalk.dim(`  Delete it anyway with: git branch -D ${wt.branch}`));
        return;
      }
      console.log(chalk.red(`Failed: ${err instanceof Error ? err.message : String(err)}`));
    }
    return;
  }

  console.log(chalk.red(`Unknown subcommand for epic: ${sub}`));
}

async function sprintOp(sub: string, sprintId: string, args: WorktreeArgs, storage: Awaited<ReturnType<typeof createStorage>>): Promise<void> {
  const sprints = await storage.getSprints();
  const sprint = sprints.find(s => s.id === sprintId);
  if (!sprint) {
    console.log(chalk.red(`Sprint "${sprintId}" not found`));
    return;
  }

  if (sub === 'create') {
    if (sprint.worktree) {
      console.log(chalk.red(`Sprint already has a worktree at ${sprint.worktree.path}`));
      console.log(chalk.dim(`Remove it first with: tkxr worktree remove ${sprintId}`));
      return;
    }
    if (!(await isGitRepo())) {
      console.log(chalk.red('Not a git repository.'));
      return;
    }
    try {
      const result = await createSprintWorktree({
        sprintId,
        path: args.path,
        branch: args.branch,
        base: args.base,
      });
      const wt = { path: result.path, branch: result.branch, createdAt: new Date().toISOString() };
      const updated = await storage.updateSprint(sprintId, { worktree: wt });
      if (updated) await notifier.notifySprintUpdated(updated);
      console.log(chalk.green(`✓ Sprint worktree created`));
      console.log(`  Path:   ${chalk.blue(result.path)}`);
      console.log(`  Branch: ${chalk.blue(result.branch)}${args.base ? chalk.dim(`  (based on ${args.base})`) : ''}`);
      console.log(chalk.dim(`  cd "${result.path}"`));
      console.log(chalk.dim(`  Tickets in this workspace with no epic worktree will branch off ${result.branch}.`));
    } catch (err) {
      console.log(chalk.red(`Failed: ${err instanceof Error ? err.message : String(err)}`));
    }
    return;
  }

  if (sub === 'remove') {
    const wt = sprint.worktree;
    if (!wt) {
      console.log(chalk.yellow(`Sprint "${sprintId}" has no worktree.`));
      return;
    }
    try {
      await removeWorktree({
        path: wt.path,
        branch: wt.branch,
        force: !!args.force,
        keepBranch: !!args['keep-branch'],
      });
      const updated = await storage.updateSprint(sprintId, { worktree: null });
      if (updated) await notifier.notifySprintUpdated(updated);
      console.log(chalk.green(`✓ Sprint worktree removed`));
      console.log(`  Path:   ${wt.path}`);
      console.log(`  Branch: ${wt.branch}${args['keep-branch'] ? chalk.dim(' (kept)') : ' (deleted)'}`);
    } catch (err) {
      if (err instanceof BranchKeptError) {
        const updated = await storage.updateSprint(sprintId, { worktree: null });
        if (updated) await notifier.notifySprintUpdated(updated);
        console.log(chalk.green(`✓ Sprint worktree removed`));
        console.log(`  Path:   ${wt.path}`);
        console.log(`  Branch: ${wt.branch}${chalk.yellow(' (kept — unmerged commits)')}`);
        console.log(chalk.dim(`  Delete it anyway with: git branch -D ${wt.branch}`));
        return;
      }
      console.log(chalk.red(`Failed: ${err instanceof Error ? err.message : String(err)}`));
    }
    return;
  }

  console.log(chalk.red(`Unknown subcommand for sprint: ${sub}`));
}

function showHelp() {
  console.log(chalk.blue.bold('tkxr worktree — manage per-ticket, per-epic and per-sprint git worktrees'));
  console.log();
  console.log(chalk.green('Usage:'));
  console.log('  tkxr worktree create <id> [options]  Create a worktree + branch for a ticket, epic or sprint');
  console.log('  tkxr worktree remove <id> [options]  Remove the worktree (id can be a ticket, epic or sprint id)');
  console.log('  tkxr worktree list                   List all git worktrees in this repo');
  console.log();
  console.log(chalk.dim('  Ticket ids start with `tas-`/`bug-`; epic ids with `epi-`; sprint ids with `spr-`.'));
  console.log(chalk.dim('  Epic worktrees default to path ../<repo>-worktrees/epics/<epicId> on tkxr/epic/<epicId>.'));
  console.log(chalk.dim('  Sprint worktrees default to path ../<repo>-worktrees/sprints/<sprintId> on tkxr/sprint/<sprintId>.'));
  console.log(chalk.dim('  A ticket branch bases on its epic branch when the epic has a worktree, else its sprint branch, else HEAD.'));
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
