<script lang="ts">
  // Read-only branch state for tickets + sprints. Fetches from
  // /api/tickets/:id/git or /api/sprints/:id/git and renders commits +
  // diff-stat + a GitHub link. Solves the "commits are invisible because
  // they live in a per-ticket worktree outside VSCode" gap.

  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import { copyToClipboard, showToast } from './clipboard';
  import { ghConfig } from './stores';

  export let scope: 'ticket' | 'sprint';
  export let id: string;
  /** Worktree path — shown in the footer so the user knows where the branch lives. */
  export let worktreePath: string;

  interface BranchCommit {
    sha: string;
    shortSha: string;
    subject: string;
    author: string;
    at: string;
  }
  interface DiffStat {
    filesChanged: number;
    insertions: number;
    deletions: number;
  }
  interface Insights {
    branch: string;
    base: string;
    head: string;
    headShort: string;
    commits: BranchCommit[];
    diffStat: DiffStat;
    dirty: boolean;
    empty: boolean;
    remote: { exists: boolean; ahead: number; behind: number };
    webUrls?: { branch: string; compare: string };
  }

  const dispatch = createEventDispatcher<{ reload: void }>();

  let insights: Insights | null = null;
  let loading = false;
  let error: string | null = null;
  let showAllCommits = false;

  async function load() {
    if (!id) return;
    loading = true;
    error = null;
    try {
      const path = scope === 'ticket' ? `/api/tickets/${id}/git` : `/api/sprints/${id}/git`;
      const res = await fetch(path);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        error = body?.error || `HTTP ${res.status}`;
        insights = null;
        return;
      }
      const body = await res.json();
      insights = body.insights ?? null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      insights = null;
    } finally {
      loading = false;
    }
  }

  onMount(load);

  // WebSocket-driven refresh: whenever a claude run exits we might have new
  // commits, so poll once. Cheap read; no need to plumb a bespoke event.
  let ws: WebSocket | null = null;
  onMount(() => {
    try {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${window.location.host}`);
      ws.onmessage = (ev) => {
        let msg: any;
        try { msg = JSON.parse(String(ev.data)); } catch { return; }
        if (msg?.type === 'claude_run_exit') load();
      };
    } catch {
      // Ignore — the fetch on mount already succeeded (or failed loudly).
    }
    return () => { try { ws?.close(); } catch { /* noop */ } };
  });
  onDestroy(() => { try { ws?.close(); } catch { /* noop */ } });

  // Reload when id changes (e.g. user switches panel to another ticket).
  $: if (id) load();

  // Push + open PR state. `prResult` sticks around after success so the user
  // can copy/click the URL again without re-hitting the endpoint.
  let prBusy = false;
  let prError: string | null = null;
  let prResult: { url: string; created: boolean; pushed: boolean; base: string; head: string } | null = null;

  async function pushAndOpenPr() {
    if (!insights || prBusy) return;
    prBusy = true;
    prError = null;
    try {
      const path = scope === 'ticket' ? `/api/tickets/${id}/pr` : `/api/sprints/${id}/pr`;
      const res = await fetch(path, { method: 'POST' });
      const body = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        const msg = body?.error?.message || `HTTP ${res.status}`;
        prError = msg;
        showToast(msg, 'error', 5000);
        return;
      }
      prResult = body;
      // Refresh insights so the "unpushed" badge disappears immediately.
      await load();
      if (body.created) {
        showToast('PR opened', 'success');
      } else {
        showToast(body.pushed ? 'Pushed to existing PR' : 'PR already open', 'info');
      }
      // Open in a new tab so the user doesn't lose their tkxr context.
      try { window.open(body.url, '_blank', 'noopener'); } catch { /* popup blocked */ }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      prError = msg;
      showToast(msg, 'error', 5000);
    } finally {
      prBusy = false;
    }
  }

  async function copyBranchName() {
    if (!insights) return;
    const ok = await copyToClipboard(insights.branch);
    showToast(ok ? 'Branch name copied' : 'Copy failed', ok ? 'success' : 'error');
  }

  function relTime(iso: string): string {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return '';
    const dt = (Date.now() - t) / 1000;
    if (dt < 60) return `${Math.floor(dt)}s ago`;
    if (dt < 3600) return `${Math.floor(dt / 60)}m ago`;
    if (dt < 86400) return `${Math.floor(dt / 3600)}h ago`;
    return `${Math.floor(dt / 86400)}d ago`;
  }

  $: visibleCommits = insights ? (showAllCommits ? insights.commits : insights.commits.slice(0, 5)) : [];
</script>

<div class="bi">
  <div class="bi-head">
    <span class="bi-title">Branch insights</span>
    <button class="bi-refresh" title="Refresh" on:click={load} disabled={loading}>
      {loading ? '…' : '↻'}
    </button>
  </div>

  {#if error}
    <div class="bi-error">{error}</div>
  {:else if !insights}
    <div class="bi-loading">{loading ? 'Loading…' : 'No data.'}</div>
  {:else}
    <div class="bi-meta">
      <div class="bi-row"><span class="bi-k">Branch</span><span class="bi-v mono">{insights.branch}</span></div>
      <div class="bi-row"><span class="bi-k">Base</span><span class="bi-v mono">{insights.base}</span></div>
      <div class="bi-row"><span class="bi-k">HEAD</span><span class="bi-v mono">{insights.headShort || '—'}</span></div>
    </div>

    <div class="bi-badges">
      {#if insights.empty}
        <span class="badge muted">No commits ahead of {insights.base}</span>
      {:else}
        <span class="badge">{insights.commits.length} commit{insights.commits.length === 1 ? '' : 's'} ahead</span>
        {#if insights.diffStat.filesChanged > 0}
          <span class="badge">
            {insights.diffStat.filesChanged} file{insights.diffStat.filesChanged === 1 ? '' : 's'}
            {#if insights.diffStat.insertions > 0}<span class="add">+{insights.diffStat.insertions}</span>{/if}
            {#if insights.diffStat.deletions > 0}<span class="del">−{insights.diffStat.deletions}</span>{/if}
          </span>
        {/if}
      {/if}
      {#if insights.dirty}
        <span class="badge warn">Uncommitted changes</span>
      {/if}
      {#if insights.remote.exists}
        {#if insights.remote.ahead > 0}
          <span class="badge">↑{insights.remote.ahead} unpushed</span>
        {/if}
        {#if insights.remote.behind > 0}
          <span class="badge warn">↓{insights.remote.behind} behind origin</span>
        {/if}
        {#if insights.remote.ahead === 0 && insights.remote.behind === 0}
          <span class="badge muted">In sync with origin</span>
        {/if}
      {:else}
        <span class="badge warn">Not on remote</span>
      {/if}
    </div>

    {#if visibleCommits.length > 0}
      <ol class="bi-commits">
        {#each visibleCommits as c (c.sha)}
          <li>
            <span class="mono short">{c.shortSha}</span>
            <span class="subj" title={c.subject}>{c.subject}</span>
            <span class="rel" title={c.at}>{relTime(c.at)}</span>
          </li>
        {/each}
      </ol>
      {#if insights.commits.length > 5}
        <button class="bi-more" on:click={() => (showAllCommits = !showAllCommits)}>
          {showAllCommits ? 'Show fewer' : `Show all ${insights.commits.length}`}
        </button>
      {/if}
    {/if}

    <div class="bi-actions">
      {#if insights.webUrls?.branch}
        <a class="btn" href={insights.webUrls.branch} target="_blank" rel="noopener">Open branch</a>
      {/if}
      {#if insights.webUrls?.compare && !insights.empty}
        <a class="btn" href={insights.webUrls.compare} target="_blank" rel="noopener">Compare vs {insights.base}</a>
      {/if}
      <button class="btn" on:click={copyBranchName}>Copy branch name</button>
      {#if !insights.empty}
        {#if $ghConfig?.available && $ghConfig?.authenticated}
          <button
            class="btn btn-primary"
            on:click={pushAndOpenPr}
            disabled={prBusy}
            title="Pushes {insights.branch} to origin then opens a draft PR against {insights.base}"
          >
            {prBusy ? 'Working…' : prResult ? 'Re-open PR' : 'Push + open PR'}
          </button>
        {:else if $ghConfig?.available}
          <button class="btn" disabled title="gh CLI found but not authenticated — run `gh auth login` on the server">
            gh not authenticated
          </button>
        {:else}
          <button class="btn" disabled title="gh CLI not on server PATH">
            gh unavailable
          </button>
        {/if}
      {/if}
    </div>

    {#if prResult}
      <div class="bi-pr">
        <span class="pr-label">PR:</span>
        <a class="pr-url" href={prResult.url} target="_blank" rel="noopener">{prResult.url}</a>
        <span class="pr-meta">→ {prResult.base}</span>
      </div>
    {:else if prError}
      <div class="bi-pr err">{prError}</div>
    {/if}

    <div class="bi-foot">
      <span class="mono foot-path" title={worktreePath}>{worktreePath}</span>
    </div>
  {/if}
</div>

<style>
  .bi {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 12px;
  }
  .bi-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }
  .bi-title { font-weight: 600; color: var(--text); font-size: 12px; }
  .bi-refresh {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--muted);
    border-radius: 5px;
    padding: 2px 8px;
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
  }
  .bi-refresh:hover { color: var(--text); border-color: var(--text2); }
  .bi-refresh:disabled { opacity: 0.5; cursor: default; }

  .bi-error { color: #ff6b6b; font-size: 11.5px; }
  .bi-loading { color: var(--faint); font-size: 11.5px; }

  .bi-meta { display: flex; flex-direction: column; gap: 3px; }
  .bi-row { display: flex; gap: 8px; }
  .bi-k { color: var(--faint); min-width: 52px; font-size: 11px; }
  .bi-v { color: var(--text2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .bi-badges { display: flex; flex-wrap: wrap; gap: 4px; }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10.5px;
    color: var(--text2);
    background: var(--chip);
    border: 1px solid var(--border);
    padding: 2px 6px;
    border-radius: 4px;
  }
  .badge.muted { color: var(--faint); }
  .badge.warn { color: #f2b544; border-color: rgba(242, 181, 68, 0.35); background: rgba(242, 181, 68, 0.08); }
  .badge .add { color: #46c17f; margin-left: 4px; }
  .badge .del { color: #ff6b6b; margin-left: 2px; }

  .bi-commits {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    border-top: 1px solid var(--border-subtle);
    padding-top: 6px;
  }
  .bi-commits li {
    display: grid;
    grid-template-columns: 60px 1fr auto;
    gap: 8px;
    align-items: baseline;
    font-size: 11.5px;
    color: var(--text2);
  }
  .bi-commits .short { color: var(--faint); font-size: 10.5px; }
  .bi-commits .subj {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bi-commits .rel { color: var(--faint); font-size: 10.5px; }

  .bi-more {
    align-self: flex-start;
    background: transparent;
    border: none;
    color: var(--accent, #6ea8ff);
    font-size: 11px;
    cursor: pointer;
    padding: 0;
  }
  .bi-more:hover { text-decoration: underline; }

  .bi-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding-top: 6px;
    border-top: 1px solid var(--border-subtle);
  }
  .btn {
    background: var(--card);
    border: 1px solid var(--border);
    color: var(--text2);
    border-radius: 5px;
    padding: 3px 8px;
    font-size: 11px;
    cursor: pointer;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
  }
  .btn:hover:not(:disabled) { color: var(--text); border-color: var(--text2); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-primary {
    background: var(--accent, #6ea8ff);
    color: #0b1220;
    border-color: transparent;
    font-weight: 600;
  }
  .btn-primary:hover:not(:disabled) {
    color: #0b1220;
    filter: brightness(1.08);
    border-color: transparent;
  }

  .bi-pr {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-top: 6px;
    border-top: 1px solid var(--border-subtle);
    font-size: 11px;
    flex-wrap: wrap;
  }
  .bi-pr.err { color: #ff6b6b; }
  .pr-label { color: var(--faint); }
  .pr-url {
    color: var(--accent, #6ea8ff);
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
  .pr-url:hover { text-decoration: underline; }
  .pr-meta { color: var(--faint); font-size: 10.5px; }

  .bi-foot {
    border-top: 1px solid var(--border-subtle);
    padding-top: 6px;
    color: var(--faint);
  }
  .foot-path {
    font-size: 10.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: block;
  }

  .mono { font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace; }
</style>
