<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Sprint, Ticket, User } from './stores';
  import { claudeAvailable } from './settings';
  import { runPrompt } from './claudeRun';
  import { epicPlanPrompt, triagePrompt } from './prompts';
  import { normalizeTicket } from './util';
  import { showToast } from './clipboard';
  import Sparkles from './icons/Sparkles.svelte';
  import X from './icons/X.svelte';

  export let tickets: Ticket[] = [];
  export let users: User[] = [];
  export let sprints: Sprint[] = [];
  /** Active workspace sprint, or null in the Unsorted pseudo-workspace. */
  export let workspace: Sprint | null = null;

  const dispatch = createEventDispatcher();

  // Every finding filters the board. The old `draft_sprint` kind — "draft the
  // next sprint out of the sprintless backlog" — stopped being reachable when
  // a sprint became the workspace frame (tas-hr2pCGjr); the ungrouped-backlog
  // finding below is its epic-shaped replacement (tas-R0J1AGqs). `plan` marks
  // the findings that additionally offer a Claude hand-off.
  type Item = { id: string; severity: 'info' | 'warn' | 'high'; title: string; detail: string; kind: 'filter'; params?: any; plan?: boolean };

  $: findings = compute(tickets);

  function compute(all: Ticket[]): { summary: string; items: Item[] } {
    const open = all.filter(t => t.status !== 'done');
    const items: Item[] = [];
    const unassigned = open.filter(t => !t.assignee);
    if (unassigned.length > 0) {
      items.push({
        id: 'unassigned',
        severity: 'warn',
        title: `${unassigned.length} open ticket${unassigned.length === 1 ? '' : 's'} have no owner`,
        detail: unassigned.slice(0, 4).map(t => t.id).join(', ') + (unassigned.length > 4 ? '…' : ''),
        kind: 'filter',
        params: { assignee: 'none' },
      });
    }
    const crit = open.filter(t => t.priority === 'critical');
    if (crit.length > 0) {
      items.push({
        id: 'crit',
        severity: 'high',
        title: `${crit.length} critical ticket${crit.length === 1 ? '' : 's'} still open`,
        detail: crit.slice(0, 2).map(t => t.title).join(' · '),
        kind: 'filter',
      });
    }
    const stale = open.filter(t => t.status === 'progress' && (Date.now() - new Date(t.updatedAt).getTime()) > 7 * 24 * 60 * 60 * 1000);
    if (stale.length > 0) {
      items.push({
        id: 'stale',
        severity: 'info',
        title: `${stale.length} in-progress ticket${stale.length === 1 ? '' : 's'} untouched > 7 days`,
        detail: stale.slice(0, 3).map(t => t.id).join(', '),
        kind: 'filter',
      });
    }
    // A sprint frames the whole workspace now (tas-hr2pCGjr), so "backlog with
    // no sprint" no longer describes anything the user is looking at — it could
    // never fire. Epics are the in-workspace grouping, so the equivalent signal
    // is ungrouped backlog.
    const ungrouped = open.filter(t => t.status === 'backlog' && !t.epic);
    if (ungrouped.length >= 4) {
      items.push({
        id: 'plan',
        severity: 'info',
        title: `${ungrouped.length} backlog tickets have no epic`,
        detail: 'Group them so the board reads as work streams, not a flat list.',
        kind: 'filter',
        params: { epic: 'none' },
        plan: true,
      });
    }
    return {
      summary: `Scanned ${open.length} open ticket${open.length === 1 ? '' : 's'}. ${items.length} finding${items.length === 1 ? '' : 's'}.`,
      items,
    };
  }

  function severityColor(s: string) {
    return s === 'high' ? '#ff6b6b' : s === 'warn' ? '#f2b544' : '#4c8dff';
  }

  function copyFullTriage() {
    runPrompt(triagePrompt(tickets, users, sprints), { label: 'Triage' });
  }
  // Hand the ungrouped backlog to Claude to bucket into epics. The epic-shaped
  // successor to the old "draft the next sprint" action (tas-R0J1AGqs).
  //
  // Fetches its own slice rather than reusing the `tickets` prop: that prop is
  // the board's paged store (page 1, 50 rows) narrowed by whatever filters are
  // active, so handing it over would silently under-scope the plan — Claude
  // would group a fraction of the backlog and report the job done. Same reason
  // EpicPanel and the sprint burn strip fetch their own slices.
  let planBusy = false;
  async function groupIntoEpics() {
    if (planBusy) return;
    planBusy = true;
    try {
      const params = new URLSearchParams({ epic: 'none', status: 'backlog', limit: '200' });
      // `workspace` is null in the Unsorted pseudo-workspace, which is the
      // `none` sentinel server-side — not "every sprint".
      params.set('sprint', workspace ? workspace.id : 'none');
      const res = await fetch(`/api/tickets?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const items: any[] = Array.isArray(j) ? j : (j.items || []);
      const scoped = items.map(normalizeTicket);
      if (scoped.length === 0) {
        showToast('Nothing ungrouped to plan', 'error', 3000);
        return;
      }
      runPrompt(epicPlanPrompt(workspace, scoped, users), {
        cwd: workspace?.worktree?.path,
        label: 'Group backlog into epics',
      });
    } catch {
      showToast('Could not load the ungrouped backlog', 'error', 4000);
    } finally {
      planBusy = false;
    }
  }
  function runItem(item: Item) {
    dispatch('applyFilter', item.params || {});
  }
</script>

<header class="head">
  <Sparkles size={16} color="var(--ai)" />
  <span class="title">Triage</span>
  <button class="close" on:click={() => dispatch('close')}><X size={16} /></button>
</header>

<div class="body">
  <div class="summary">{findings.summary}</div>

  <div class="hero">
    <div class="hero-txt">
      {#if $claudeAvailable}
        <div class="hero-t">Run triage in Claude</div>
        <div class="hero-s">Sends a full triage prompt (open tickets + tkxr MCP reminder) straight to the claude CLI. Live output streams into the run panel.</div>
      {:else}
        <div class="hero-t">Hand triage to Claude Code</div>
        <div class="hero-s">Copies a full triage prompt (open tickets + tkxr MCP reminder). Paste into Claude Code — it'll use the tkxr MCP tools to inspect + fix.</div>
      {/if}
    </div>
    <button class="btn btn-primary" on:click={copyFullTriage}>
      {$claudeAvailable ? 'Run in Claude' : 'Copy triage prompt'}
    </button>
  </div>

  <!--
    No "plan this sprint" card. Planning is epic-level — a sprint has no goal
    worth decomposing, an epic does. Triage's job at this level is to sort the
    sprint's tickets into epics, which the ungrouped-backlog finding does.
  -->

  {#each findings.items as it}
    <div class="card">
      <div class="row1">
        <span class="dot" style="background:{severityColor(it.severity)}"></span>
        <span class="t">{it.title}</span>
      </div>
      {#if it.detail}
        <div class="detail">{it.detail}</div>
      {/if}
      <div class="row-actions">
        {#if it.plan}
          <button class="btn" on:click={groupIntoEpics} disabled={planBusy}>
            {$claudeAvailable ? 'Group with Claude' : 'Copy grouping prompt'}
          </button>
        {/if}
        <button class="btn" on:click={() => runItem(it)}>Show me</button>
      </div>
    </div>
  {/each}

  {#if findings.items.length === 0}
    <div class="empty">Nothing needs attention. 🎉</div>
  {/if}
</div>

<style>
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border-subtle);
  }
  .title { flex: 1; font-size: 14px; font-weight: 600; }
  .close { background: transparent; border: none; color: var(--muted); cursor: pointer; padding: 4px; border-radius: 5px; }
  .close:hover { background: var(--surface-hover); color: var(--text); }
  .body {
    flex: 1;
    overflow-y: auto;
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .summary {
    font-size: 12.5px;
    color: var(--muted);
    padding-bottom: 4px;
  }
  .hero {
    background: rgba(107,91,255,.08);
    border: 1px solid rgba(107,91,255,.28);
    border-radius: 10px;
    padding: 12px;
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .hero-txt { flex: 1; display: flex; flex-direction: column; gap: 4px; }
  .hero-t { font-size: 12.5px; font-weight: 600; color: var(--text); }
  .hero-s { font-size: 11px; color: var(--muted); line-height: 1.4; }
  .card {
    background: var(--elevated);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .row1 { display: flex; align-items: center; gap: 8px; }
  .dot { width: 8px; height: 8px; border-radius: 3px; flex: none; }
  .t { font-size: 12.5px; font-weight: 600; color: var(--text); }
  .detail { font-size: 12px; color: var(--muted); }
  .row-actions { display: flex; justify-content: flex-end; gap: 8px; }
  .empty { color: var(--faint); font-size: 12.5px; padding: 20px; text-align: center; }
</style>
