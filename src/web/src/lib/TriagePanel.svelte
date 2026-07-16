<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Sprint, Ticket, User } from './stores';
  import { claudeAvailable } from './settings';
  import { runPrompt } from './claudeRun';
  import { sprintBreakdownPrompt, sprintPlanPrompt, triagePrompt } from './prompts';
  import Sparkles from './icons/Sparkles.svelte';
  import X from './icons/X.svelte';

  export let tickets: Ticket[] = [];
  export let users: User[] = [];
  export let sprints: Sprint[] = [];

  const dispatch = createEventDispatcher();

  type Item = { id: string; severity: 'info' | 'warn' | 'high'; title: string; detail: string; kind: 'filter' | 'draft_sprint'; params?: any };

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
    const backlog = open.filter(t => t.status === 'backlog' && !t.sprint);
    if (backlog.length >= 4) {
      items.push({
        id: 'plan',
        severity: 'info',
        title: `Draft the next sprint (${backlog.length} backlog tickets)`,
        detail: 'Auto-balance a planning sprint from the backlog.',
        kind: 'draft_sprint',
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
  function copyPlan() {
    runPrompt(sprintPlanPrompt(sprints, tickets, users), { label: 'Sprint plan' });
  }
  function planSprint(sprint: Sprint) {
    runPrompt(sprintBreakdownPrompt(sprint, tickets, users), {
      cwd: sprint.worktree?.path,
      label: 'Plan ' + sprint.name,
    });
  }
  $: planningSprints = sprints.filter(s => s.status === 'planning' && !!s.goal && s.goal.trim().length > 0);
  function runItem(item: Item) {
    if (item.kind === 'draft_sprint') copyPlan();
    else dispatch('applyFilter', item.params || {});
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

  {#each planningSprints as s (s.id)}
    <div class="card">
      <div class="row1">
        <Sparkles size={14} color="var(--ai)" />
        <span class="t">Plan sprint "{s.name}" with Claude</span>
      </div>
      <div class="detail">Break the goal into child tickets (waves via <code>dependsOn</code>). Guardrails: won't touch existing tickets, capped at ~12 new tickets.</div>
      <div class="row-actions">
        <button class="btn" on:click={() => planSprint(s)}>
          {$claudeAvailable ? 'Plan with Claude' : 'Copy plan prompt'}
        </button>
      </div>
    </div>
  {/each}

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
        <button class="btn" on:click={() => runItem(it)}>
          {it.kind === 'draft_sprint'
            ? ($claudeAvailable ? 'Run in Claude' : 'Copy plan prompt')
            : 'Show me'}
        </button>
      </div>
    </div>
  {/each}

  {#if findings.items.length === 0 && planningSprints.length === 0}
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
  .detail code {
    background: var(--surface);
    border-radius: 4px;
    padding: 1px 4px;
    font-size: 10.5px;
  }
  .row-actions { display: flex; justify-content: flex-end; }
  .empty { color: var(--faint); font-size: 12.5px; padding: 20px; text-align: center; }
</style>
