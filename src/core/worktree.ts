import { promises as fs } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

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

export function defaultSprintWorktreePath(repoRoot: string, sprintId: string, override?: string): string {
  if (override) return path.resolve(override);
  const envRoot = process.env.TKXR_WORKTREE_ROOT;
  if (envRoot) return path.resolve(envRoot, 'sprints', sprintId);
  const parent = path.dirname(repoRoot);
  const name = path.basename(repoRoot);
  return path.join(parent, `${name}-worktrees`, 'sprints', sprintId);
}

export function defaultSprintBranch(sprintId: string, override?: string): string {
  if (override) return override;
  return `tkxr/sprint/${sprintId}`;
}

export interface CreateSprintWorktreeOptions {
  sprintId: string;
  path?: string;
  branch?: string;
  base?: string;
  cwd?: string;
}

export async function createSprintWorktree(opts: CreateSprintWorktreeOptions): Promise<{ path: string; branch: string }> {
  const cwd = opts.cwd || process.cwd();
  if (!(await isGitRepo(cwd))) {
    throw new Error('Not a git repository — worktree operations require git.');
  }
  const repoRoot = await getRepoRoot(cwd);
  const wtPath = defaultSprintWorktreePath(repoRoot, opts.sprintId, opts.path);
  const branch = defaultSprintBranch(opts.sprintId, opts.branch);
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

export interface RemoveWorktreeOptions {
  path: string;
  force?: boolean;
  keepBranch?: boolean;
  branch?: string;
  cwd?: string;
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
    // If already gone / stale, prune to reconcile.
    await run('git worktree prune', repoRoot).catch(() => {});
    throw new Error(`git worktree remove failed: ${(err.stderr || err.message || '').trim()}`);
  }
  await run('git worktree prune', repoRoot).catch(() => {});
  if (opts.branch && !opts.keepBranch) {
    // Best-effort branch delete; don't fail the whole op if the branch has unmerged commits.
    await run(`git branch -D ${opts.branch}`, repoRoot).catch(() => {});
  }
}
