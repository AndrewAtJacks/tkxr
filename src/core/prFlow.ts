// GitHub PR flow — push a branch and create/lookup a PR via the `gh` CLI.
//
// Why gh: hits the same Git host the user's remote points at, honors their
// existing auth (`gh auth status`), and gives us a stable JSON contract for
// "is there already a PR on this head" — cheaper than reimplementing on top
// of the GitHub REST API from scratch.
//
// This module is user-triggered only. No boot-time side effects, no polling.
// All mutations (push, create) map to explicit clicks in the UI.

import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/** Never throws. When gh isn't available, callers fall back to a copy-URL toast. */
export interface GhConfig {
  available: boolean;
  /** Version reported by `gh --version` (first token), when the probe succeeded. */
  version?: string;
  /** True when `gh auth status` exits 0. False when gh exists but the user isn't logged in. */
  authenticated?: boolean;
  /** Set only when we deliberately disabled gh (TKXR_GH_DISABLED). */
  disabled?: boolean;
}

function isGhDisabled(): boolean {
  const v = process.env.TKXR_GH_DISABLED;
  if (!v) return false;
  const norm = v.trim().toLowerCase();
  return norm === '1' || norm === 'true' || norm === 'yes';
}

/**
 * Boot-time probe for the `gh` CLI. Runs `gh --version` and `gh auth status`.
 * Cached on `app.locals.gh` by the serve command; consumers never re-probe.
 */
export async function discoverGh(): Promise<GhConfig> {
  if (isGhDisabled()) return { available: false, disabled: true };

  try {
    const { stdout } = await execAsync('gh --version', { timeout: 3000 });
    const version = stdout.trim().split(/\s+/)[2] || undefined;
    let authenticated = false;
    try {
      await execAsync('gh auth status', { timeout: 5000 });
      authenticated = true;
    } catch {
      // `gh auth status` exits non-zero when not logged in. Not a hard failure —
      // the UI surfaces this so the user can `gh auth login`.
    }
    return { available: true, version, authenticated };
  } catch {
    return { available: false };
  }
}

export interface CreatePrOptions {
  /** Worktree path where the head branch is checked out. All git+gh calls run here. */
  cwd: string;
  /** Branch to push + open the PR from. */
  head: string;
  /** PR target branch. Must already exist on origin. */
  base: string;
  title: string;
  body: string;
  /** Default true. Draft PRs are opt-in-ready — safer default for automated flows. */
  draft?: boolean;
}

export interface CreatePrResult {
  url: string;
  /** False when we reused an existing PR on the same head. */
  created: boolean;
  /** False when the branch was already in sync with origin. */
  pushed: boolean;
  head: string;
  base: string;
}

/** Discriminator for callers that want to render an actionable error. */
export type PrFlowErrorCode =
  | 'gh_missing'
  | 'gh_not_authenticated'
  | 'no_remote'
  | 'base_not_on_remote'
  | 'push_failed'
  | 'pr_lookup_failed'
  | 'pr_create_failed'
  | 'unknown';

export class PrFlowError extends Error {
  code: PrFlowErrorCode;
  detail?: string;
  constructor(code: PrFlowErrorCode, message: string, detail?: string) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Full flow: verify origin exists, verify base is on origin, push head,
 * lookup existing PR on head, create if missing. Returns the PR URL.
 *
 * Idempotent: safe to call again after success — it'll find the existing
 * PR and just re-push any new commits.
 */
export async function pushAndOpenPr(opts: CreatePrOptions, gh: GhConfig): Promise<CreatePrResult> {
  if (!gh.available) {
    throw new PrFlowError('gh_missing', 'The GitHub CLI (`gh`) is not installed on the server.');
  }
  if (gh.authenticated === false) {
    throw new PrFlowError(
      'gh_not_authenticated',
      'The GitHub CLI is installed but not authenticated. Run `gh auth login` on the server host.',
    );
  }

  // Sanity: repo has an origin.
  try {
    await execAsync('git config --get remote.origin.url', { cwd: opts.cwd });
  } catch {
    throw new PrFlowError('no_remote', 'This repo has no `origin` remote configured.');
  }

  // Sanity: base branch exists on origin. If not, refuse — pushing the base
  // ourselves could clobber a shared branch that diverged. Ask the user to
  // push it explicitly (e.g. via the sprint panel's own PR button).
  const baseExists = await remoteBranchExists(opts.cwd, opts.base);
  if (!baseExists) {
    throw new PrFlowError(
      'base_not_on_remote',
      `Base branch \`${opts.base}\` is not on origin yet. Push it first (e.g. open a PR for the sprint) before opening a PR for this ticket.`,
    );
  }

  // Push the head branch. `-u` sets upstream so future pushes are simple.
  // Never `--force`.
  const pushed = await pushBranch(opts.cwd, opts.head);

  // Lookup existing PR before creating a new one.
  const existing = await lookupPrByHead(opts.cwd, opts.head);
  if (existing) {
    return {
      url: existing.url,
      created: false,
      pushed,
      head: opts.head,
      base: opts.base,
    };
  }

  // Create a new PR. Draft by default so the user can review before it goes
  // out for review.
  const draft = opts.draft ?? true;
  const url = await createPr(opts.cwd, {
    head: opts.head,
    base: opts.base,
    title: opts.title,
    body: opts.body,
    draft,
  });
  return { url, created: true, pushed, head: opts.head, base: opts.base };
}

async function remoteBranchExists(cwd: string, branch: string): Promise<boolean> {
  try {
    // ls-remote is authoritative: it hits origin, doesn't rely on a stale
    // local remote-tracking ref.
    const { stdout } = await execAsync(`git ls-remote --heads origin ${quote(branch)}`, { cwd, timeout: 10000 });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function pushBranch(cwd: string, head: string): Promise<boolean> {
  // Determine whether we're already in sync so the return value is truthful.
  let inSync = false;
  try {
    const { stdout } = await execAsync(
      `git rev-list --left-right --count origin/${quote(head)}...${quote(head)}`,
      { cwd, timeout: 10000 },
    );
    const [behind, ahead] = stdout.trim().split(/\s+/).map(n => Number(n));
    inSync = Number.isFinite(ahead) && Number.isFinite(behind) && ahead === 0 && behind === 0;
  } catch {
    // origin/<head> doesn't exist yet — push will create it.
  }

  try {
    await execAsync(`git push -u origin ${quote(head)}`, { cwd, timeout: 60000 });
    return !inSync;
  } catch (err: any) {
    throw new PrFlowError('push_failed', `git push failed`, String(err?.stderr || err?.message || err));
  }
}

async function lookupPrByHead(cwd: string, head: string): Promise<{ url: string; state: string } | null> {
  try {
    // --json url,state gives us a stable machine-readable answer; --state all
    // so we can distinguish "already open" from "closed, need a new one".
    const { stdout } = await execAsync(
      `gh pr list --head ${quote(head)} --state all --json url,state --limit 5`,
      { cwd, timeout: 10000 },
    );
    const list = JSON.parse(stdout || '[]') as Array<{ url: string; state: string }>;
    const open = list.find(pr => pr.state === 'OPEN');
    if (open) return open;
    // Merged PRs are terminal — creating a new PR from the same head is
    // fine and expected (branch has new commits). Only reuse OPEN PRs.
    return null;
  } catch (err: any) {
    throw new PrFlowError('pr_lookup_failed', 'gh pr list failed', String(err?.stderr || err?.message || err));
  }
}

async function createPr(
  cwd: string,
  { head, base, title, body, draft }: { head: string; base: string; title: string; body: string; draft: boolean },
): Promise<string> {
  // Body is user-authored (ticket description / sprint goal); passing it via
  // an env var + `--body-file -` avoids any shell quoting foot-guns on Windows.
  // gh reads stdin when `--body-file -` is passed.
  return new Promise<string>((resolve, reject) => {
    const args = [
      'pr', 'create',
      '--head', head,
      '--base', base,
      '--title', title,
      '--body-file', '-',
    ];
    if (draft) args.push('--draft');

    const child = spawn('gh', args, {
      cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += String(c); });
    child.stderr.on('data', (c) => { stderr += String(c); });
    child.on('error', (err) => reject(new PrFlowError('pr_create_failed', 'gh pr create failed to spawn', String(err))));
    child.on('exit', (code) => {
      if (code === 0) {
        // gh prints the PR URL as the last non-empty line on stdout.
        const url = stdout
          .split(/\r?\n/)
          .map(s => s.trim())
          .filter(Boolean)
          .find(line => /^https?:\/\//.test(line)) || stdout.trim();
        if (url) resolve(url);
        else reject(new PrFlowError('pr_create_failed', 'gh pr create returned no URL', stdout + stderr));
      } else {
        reject(new PrFlowError('pr_create_failed', `gh pr create exited ${code}`, stderr || stdout));
      }
    });

    child.stdin.write(body);
    child.stdin.end();
  });
}

function quote(s: string): string {
  return `"${s.replace(/"/g, '')}"`;
}
