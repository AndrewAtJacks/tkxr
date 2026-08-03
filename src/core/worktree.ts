import { promises as fs } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import type { TicketWorktree } from './types.js';

const execAsync = promisify(exec);

async function run(cmd: string, cwd?: string): Promise<{ stdout: string; stderr: string }> {
  return execAsync(cmd, { cwd: cwd || process.cwd() });
}

export async function isGitRepo(cwd = process.cwd()): Promise<boolean> {
  try {
    const { stdout } = await run('git rev-parse --is-inside-work-tree', cwd);
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

export async function getRepoRoot(cwd = process.cwd()): Promise<string> {
  const { stdout } = await run('git rev-parse --show-toplevel', cwd);
  return stdout.trim();
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
  bare?: boolean;
  detached?: boolean;
}

export async function listWorktrees(cwd = process.cwd()): Promise<WorktreeInfo[]> {
  const { stdout } = await run('git worktree list --porcelain', cwd);
  const worktrees: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> = {};
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      if (current.path) worktrees.push(current as WorktreeInfo);
      current = {};
      continue;
    }
    const [key, ...rest] = line.split(' ');
    const val = rest.join(' ');
    if (key === 'worktree') current.path = val;
    else if (key === 'HEAD') current.head = val;
    else if (key === 'branch') current.branch = val.replace(/^refs\/heads\//, '');
    else if (key === 'bare') current.bare = true;
    else if (key === 'detached') current.detached = true;
  }
  if (current.path) worktrees.push(current as WorktreeInfo);
  return worktrees;
}

export function defaultWorktreePath(repoRoot: string, ticketId: string, override?: string): string {
  if (override) return path.resolve(override);
  const envRoot = process.env.TKXR_WORKTREE_ROOT;
  if (envRoot) return path.resolve(envRoot, ticketId);
  const parent = path.dirname(repoRoot);
  const name = path.basename(repoRoot);
  return path.join(parent, `${name}-worktrees`, ticketId);
}

export function defaultBranch(ticketId: string, override?: string): string {
  if (override) return override;
  return `tkxr/${ticketId}`;
}

export function defaultEpicWorktreePath(repoRoot: string, epicId: string, override?: string): string {
  if (override) return path.resolve(override);
  const envRoot = process.env.TKXR_WORKTREE_ROOT;
  if (envRoot) return path.resolve(envRoot, 'epics', epicId);
  const parent = path.dirname(repoRoot);
  const name = path.basename(repoRoot);
  return path.join(parent, `${name}-worktrees`, 'epics', epicId);
}

export function defaultEpicBranch(epicId: string, override?: string): string {
  if (override) return override;
  return `tkxr/epic/${epicId}`;
}

export interface CreateEpicWorktreeOptions {
  epicId: string;
  path?: string;
  branch?: string;
  base?: string;
  cwd?: string;
}

/**
 * An epic is a feature, and a feature is what a branch is for — so this is the
 * only worktree above ticket level. A sprint frames concurrent work and owns no
 * branch; ticket branches hang off their epic's branch, or off the repo default
 * when the ticket has no epic. See `docs/branching-model.md`.
 */
export async function createEpicWorktree(opts: CreateEpicWorktreeOptions): Promise<{ path: string; branch: string }> {
  const cwd = opts.cwd || process.cwd();
  if (!(await isGitRepo(cwd))) {
    throw new Error('Not a git repository — worktree operations require git.');
  }
  const repoRoot = await getRepoRoot(cwd);
  const wtPath = defaultEpicWorktreePath(repoRoot, opts.epicId, opts.path);
  const branch = defaultEpicBranch(opts.epicId, opts.branch);
  const base = opts.base || 'HEAD';

  try {
    await fs.access(wtPath);
    throw new Error(`Path already exists: ${wtPath}`);
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }

  await fs.mkdir(path.dirname(wtPath), { recursive: true });

  const branchExists = await checkBranchExists(branch, repoRoot);
  const quotedPath = `"${wtPath}"`;
  const cmd = branchExists
    ? `git worktree add ${quotedPath} ${branch}`
    : `git worktree add -b ${branch} ${quotedPath} ${base}`;
  try {
    await run(cmd, repoRoot);
  } catch (err: any) {
    throw new Error(`git worktree add failed: ${(err.stderr || err.message || '').trim()}`);
  }

  return { path: wtPath, branch };
}

/**
 * The branch a ticket's own branch should hang off, or null for "nothing more
 * specific than HEAD / the repo default".
 *
 * Just the epic. Sprints used to sit in the middle of this chain, back when a
 * sprint was a unit of work; it now frames the whole workspace and owns no
 * branch, so a ticket with no epic is a standalone change that forks from the
 * repo default (docs/branching-model.md).
 *
 * Takes the resolved epic rather than an id so every caller — CLI, REST, MCP —
 * shares the rule without this module needing storage access.
 */
export function resolveTicketBase(
  epic: { worktree?: TicketWorktree | null } | null | undefined,
): string | null {
  return epic?.worktree ? epic.worktree.branch : null;
}

export interface CreateWorktreeOptions {
  ticketId: string;
  path?: string;
  branch?: string;
  base?: string; // base branch/ref; default HEAD
  cwd?: string;
}

export async function createWorktree(opts: CreateWorktreeOptions): Promise<{ path: string; branch: string }> {
  const cwd = opts.cwd || process.cwd();
  if (!(await isGitRepo(cwd))) {
    throw new Error('Not a git repository — worktree operations require git.');
  }
  const repoRoot = await getRepoRoot(cwd);
  const wtPath = defaultWorktreePath(repoRoot, opts.ticketId, opts.path);
  const branch = defaultBranch(opts.ticketId, opts.branch);
  const base = opts.base || 'HEAD';

  try {
    await fs.access(wtPath);
    throw new Error(`Path already exists: ${wtPath}`);
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }

  await fs.mkdir(path.dirname(wtPath), { recursive: true });

  const branchExists = await checkBranchExists(branch, repoRoot);
  const quotedPath = `"${wtPath}"`;
  const cmd = branchExists
    ? `git worktree add ${quotedPath} ${branch}`
    : `git worktree add -b ${branch} ${quotedPath} ${base}`;
  try {
    await run(cmd, repoRoot);
  } catch (err: any) {
    throw new Error(`git worktree add failed: ${(err.stderr || err.message || '').trim()}`);
  }

  return { path: wtPath, branch };
}

async function checkBranchExists(branch: string, cwd: string): Promise<boolean> {
  try {
    await run(`git show-ref --verify --quiet refs/heads/${branch}`, cwd);
    return true;
  } catch {
    return false;
  }
}

/**
 * The repo's default branch, resolved from `origin/HEAD` where it's set and
 * falling back to whichever of main/master exists. Null when neither is found
 * (a repo with no conventional trunk) — callers should treat that as "can't
 * tell" rather than assuming anything is merged.
 */
export async function getDefaultBranch(repoRoot: string): Promise<string | null> {
  try {
    const { stdout } = await run('git symbolic-ref --quiet refs/remotes/origin/HEAD', repoRoot);
    const ref = stdout.trim().replace(/^refs\/remotes\//, '');
    if (ref) return ref;
  } catch { /* origin/HEAD not set — fall through */ }
  for (const candidate of ['main', 'master']) {
    if (await checkBranchExists(candidate, repoRoot)) return candidate;
  }
  return null;
}

/**
 * True when `branch` holds no commits missing from the repo's trunk — i.e.
 * deleting it discards nothing. Returns false when the answer can't be
 * established, so an unknown always resolves to "keep the branch".
 */
export async function isBranchMerged(branch: string, repoRoot: string): Promise<boolean> {
  const base = await getDefaultBranch(repoRoot);
  if (!base || base === branch) return false;
  try {
    const { stdout } = await run(`git rev-list --count ${base}..${branch}`, repoRoot);
    return stdout.trim() === '0';
  } catch {
    return false;
  }
}

export interface RemoveWorktreeOptions {
  path: string;
  force?: boolean;
  keepBranch?: boolean;
  branch?: string;
  cwd?: string;
}

/** True when the worktree directory no longer exists on disk. */
async function worktreeDirGone(wtPath: string): Promise<boolean> {
  try {
    await fs.stat(wtPath);
    return false;
  } catch {
    return true;
  }
}

export async function removeWorktree(opts: RemoveWorktreeOptions): Promise<void> {
  const cwd = opts.cwd || process.cwd();
  if (!(await isGitRepo(cwd))) {
    throw new Error('Not a git repository.');
  }
  const repoRoot = await getRepoRoot(cwd);
  const forceFlag = opts.force ? '--force' : '';
  const quoted = `"${opts.path}"`;
  try {
    await run(`git worktree remove ${forceFlag} ${quoted}`.replace(/\s+/g, ' ').trim(), repoRoot);
  } catch (err: any) {
    // Only prune when the directory is genuinely gone — i.e. this failed
    // because git and the filesystem had already diverged.
    //
    // Pruning unconditionally here is what used to orphan a half-removed
    // worktree: `git worktree remove` can delete much of the tree (including
    // the `.git` file) and then fail on, say, a locked file under
    // node_modules. Prune then sees a worktree whose `.git` file is missing
    // and drops its admin entry, finalising the very removal that failed. The
    // result is a directory git no longer tracks and `git worktree repair`
    // cannot recover. Leave a partial failure alone so the caller can retry
    // with force, or clean up by hand.
    if (await worktreeDirGone(opts.path)) {
      await run('git worktree prune', repoRoot).catch(() => {});
    }
    throw new Error(`git worktree remove failed: ${(err.stderr || err.message || '').trim()}`);
  }
  await run('git worktree prune', repoRoot).catch(() => {});
  if (opts.branch && !opts.keepBranch) {
    // `-d`, not `-D`: refuse to delete a branch holding unmerged commits.
    // The old force-delete discarded them outright — losing work whenever a
    // ticket was completed before its branch was merged or pushed.
    try {
      await run(`git branch -d ${opts.branch}`, repoRoot);
    } catch (err: any) {
      // Unmerged (or otherwise undeletable) — keep the branch and say so.
      // The worktree is already gone at this point, which is what was asked;
      // the branch surviving is the safe outcome, not a failure.
      throw new BranchKeptError(opts.branch, (err.stderr || err.message || '').trim());
    }
  }
}

/**
 * Thrown when the worktree was removed successfully but its branch was kept
 * because it still holds unmerged commits. Callers that treat worktree removal
 * as best-effort should catch this and surface it rather than failing the
 * whole operation — the destructive part already succeeded safely.
 */
export class BranchKeptError extends Error {
  constructor(public branch: string, public detail: string) {
    super(`Worktree removed, but branch "${branch}" was kept: it has unmerged commits.`);
    this.name = 'BranchKeptError';
  }
}
