// Read-only git introspection for the "surface the work inside tkxr" flow.
//
// Ticket/sprint work lands on branches inside per-ticket or per-sprint
// worktrees that live outside the primary VSCode window's checkout, so the
// commits are invisible until published or manually merged. This module gives
// the web UI enough context to show what happened without the user having to
// leave the panel: recent commits on the branch, a diff-vs-base stat, and a
// GitHub compare/tree URL when a remote is configured.
//
// All operations are read-only. Merges + pushes stay in explicit user flows
// (commit prompt, orchestrator, or copy-command buttons) so this module can't
// touch shared history by accident.

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function run(cmd: string, cwd?: string): Promise<{ stdout: string; stderr: string }> {
  return execAsync(cmd, { cwd: cwd || process.cwd(), maxBuffer: 4 * 1024 * 1024 });
}

export interface RemoteInfo {
  /** Raw remote.origin.url — https://... or git@host:owner/repo(.git). */
  url: string;
  /** Best-effort web root (e.g. https://github.com/owner/repo). Empty when host unknown. */
  webUrl: string;
  host: string;
  owner: string;
  repo: string;
}

/**
 * Read `remote.origin.url` and normalize into a web URL. Returns null when no
 * origin is configured or the URL doesn't match a recognized pattern.
 *
 * Supported hosts: github.com, gitlab.com, bitbucket.org, and generic
 * self-hosted GitLab/Gitea via the ssh git@host:owner/repo shape.
 */
export async function getRemoteInfo(cwd?: string): Promise<RemoteInfo | null> {
  let url: string;
  try {
    const { stdout } = await run('git config --get remote.origin.url', cwd);
    url = stdout.trim();
  } catch {
    return null;
  }
  if (!url) return null;

  const parsed = parseGitUrl(url);
  if (!parsed) return { url, webUrl: '', host: '', owner: '', repo: '' };
  const { host, owner, repo } = parsed;
  const webUrl = `https://${host}/${owner}/${repo}`;
  return { url, webUrl, host, owner, repo };
}

function parseGitUrl(url: string): { host: string; owner: string; repo: string } | null {
  // git@github.com:owner/repo(.git)
  const ssh = url.match(/^[^@]+@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/);
  if (ssh) return { host: ssh[1], owner: ssh[2], repo: ssh[3] };
  // https://user@host/owner/repo(.git) or ssh://git@host/owner/repo(.git)
  const proto = url.match(/^(?:https?|ssh|git):\/\/(?:[^@]+@)?([^/]+)\/(.+?)\/([^/]+?)(?:\.git)?$/);
  if (proto) return { host: proto[1], owner: proto[2], repo: proto[3] };
  return null;
}

/**
 * Best-effort default base branch — the remote HEAD (usually `main` or
 * `master`). Falls back to `main` when the remote HEAD symbolic ref isn't set.
 */
export async function detectDefaultBase(cwd?: string): Promise<string> {
  try {
    const { stdout } = await run('git symbolic-ref refs/remotes/origin/HEAD', cwd);
    const ref = stdout.trim().replace(/^refs\/remotes\/origin\//, '');
    if (ref) return ref;
  } catch {
    // No remote HEAD set. Fall through to main.
  }
  return 'main';
}

export interface BranchCommit {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  /** ISO timestamp. */
  at: string;
}

export interface DiffStat {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface BranchInsights {
  branch: string;
  base: string;
  /** Full SHA of branch tip. Empty when branch doesn't resolve. */
  head: string;
  headShort: string;
  /** Commits on `branch` not on `base`, newest first. Capped to prevent runaway output. */
  commits: BranchCommit[];
  diffStat: DiffStat;
  /** True when the worktree has uncommitted changes (staged or unstaged). */
  dirty: boolean;
  /** True when the branch has no commits ahead of the base. */
  empty: boolean;
  /** Best-effort tri-state relationship to remote-tracking branch. */
  remote: {
    /** True when origin/<branch> exists. */
    exists: boolean;
    ahead: number;
    behind: number;
  };
  /** Populated when getRemoteInfo returned non-null AND base/branch are known. */
  webUrls?: {
    branch: string;
    compare: string;
  };
}

export interface GetBranchInsightsOptions {
  /** Worktree path — git commands run here. */
  cwd: string;
  /** Branch to inspect. */
  branch: string;
  /** Base branch to diff against. Defaults to origin HEAD (usually main). */
  base?: string;
  /** Cap on commit list. Default 50. */
  limit?: number;
  /** Skip the remote-info lookup (caller already has it). */
  remote?: RemoteInfo | null;
}

/**
 * Collect the read-only branch state the UI needs to show what's on a
 * ticket/sprint branch. Never mutates. Missing pieces degrade to empty
 * defaults so a partially-broken worktree still returns something.
 */
export async function getBranchInsights(opts: GetBranchInsightsOptions): Promise<BranchInsights> {
  const { cwd, branch } = opts;
  const limit = opts.limit ?? 50;
  const base = opts.base ?? (await detectDefaultBase(cwd));

  const insights: BranchInsights = {
    branch,
    base,
    head: '',
    headShort: '',
    commits: [],
    diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
    dirty: false,
    empty: true,
    remote: { exists: false, ahead: 0, behind: 0 },
  };

  // HEAD sha
  try {
    const { stdout } = await run(`git rev-parse ${shellQuote(branch)}`, cwd);
    insights.head = stdout.trim();
    insights.headShort = insights.head.slice(0, 7);
  } catch {
    // Branch doesn't resolve — return empty insights.
    return insights;
  }

  // Commits ahead of base
  try {
    const fmt = '%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1e';
    const { stdout } = await run(
      `git log --no-merges --pretty=format:${shellQuote(fmt)} -n ${limit} ${shellQuote(base)}..${shellQuote(branch)}`,
      cwd,
    );
    const commits: BranchCommit[] = [];
    for (const raw of stdout.split('\x1e')) {
      const line = raw.trim();
      if (!line) continue;
      const [sha, shortSha, subject, author, at] = line.split('\x1f');
      if (!sha) continue;
      commits.push({ sha, shortSha, subject: subject ?? '', author: author ?? '', at: at ?? '' });
    }
    insights.commits = commits;
    insights.empty = commits.length === 0;
  } catch {
    // git log can fail if base is missing — leave commits empty.
  }

  // Diff stat vs base
  try {
    const { stdout } = await run(
      `git diff --shortstat ${shellQuote(base)}..${shellQuote(branch)}`,
      cwd,
    );
    insights.diffStat = parseShortStat(stdout);
  } catch {
    // ignore
  }

  // Uncommitted-in-worktree state
  try {
    const { stdout } = await run('git status --porcelain', cwd);
    insights.dirty = stdout.trim().length > 0;
  } catch {
    // ignore
  }

  // Remote-tracking relationship
  try {
    const { stdout } = await run(
      `git rev-list --left-right --count origin/${shellQuote(branch)}...${shellQuote(branch)}`,
      cwd,
    );
    const [behindStr, aheadStr] = stdout.trim().split(/\s+/);
    const behind = Number(behindStr);
    const ahead = Number(aheadStr);
    insights.remote = {
      exists: true,
      ahead: Number.isFinite(ahead) ? ahead : 0,
      behind: Number.isFinite(behind) ? behind : 0,
    };
  } catch {
    // origin/<branch> doesn't exist — never pushed.
  }

  // Web URLs (compare + tree)
  const remoteInfo = opts.remote !== undefined ? opts.remote : await getRemoteInfo(cwd);
  if (remoteInfo && remoteInfo.webUrl && remoteInfo.host === 'github.com') {
    insights.webUrls = {
      branch: `${remoteInfo.webUrl}/tree/${encodeURIComponent(branch)}`,
      compare: `${remoteInfo.webUrl}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}`,
    };
  } else if (remoteInfo && remoteInfo.webUrl && remoteInfo.host === 'gitlab.com') {
    insights.webUrls = {
      branch: `${remoteInfo.webUrl}/-/tree/${encodeURIComponent(branch)}`,
      compare: `${remoteInfo.webUrl}/-/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}`,
    };
  } else if (remoteInfo && remoteInfo.webUrl && remoteInfo.host === 'bitbucket.org') {
    insights.webUrls = {
      branch: `${remoteInfo.webUrl}/src/${encodeURIComponent(branch)}`,
      compare: `${remoteInfo.webUrl}/branches/compare/${encodeURIComponent(branch)}..${encodeURIComponent(base)}`,
    };
  }

  return insights;
}

function parseShortStat(stdout: string): DiffStat {
  // Example: " 3 files changed, 42 insertions(+), 5 deletions(-)"
  const files = stdout.match(/(\d+) file/);
  const ins = stdout.match(/(\d+) insertion/);
  const del = stdout.match(/(\d+) deletion/);
  return {
    filesChanged: files ? Number(files[1]) : 0,
    insertions: ins ? Number(ins[1]) : 0,
    deletions: del ? Number(del[1]) : 0,
  };
}

/**
 * Cross-shell-safe quoting for git refs / paths inserted into a command line.
 * We only quote to protect against branch names with spaces / shell metas —
 * git itself accepts either quote style. Windows cmd + POSIX sh both accept
 * double-quotes; embedded `"` in a branch name is disallowed by git anyway.
 */
function shellQuote(s: string): string {
  return `"${s.replace(/"/g, '')}"`;
}
