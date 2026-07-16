import type { Ticket, User, Sprint } from './stores';

const MCP_REMINDER = `Use the tkxr MCP tools if attached (agent_guide, get_ticket, list_tickets, search_tickets, edit_ticket, update_ticket_status, assign_ticket, add_comment, set_ticket_sprint). If a change is warranted, apply it via the MCP tools so the web UI live-refreshes.`;

function compactTicket(t: Ticket, users: User[], sprints: Sprint[], allTickets?: Ticket[]): any {
  const assignee = t.assignee ? users.find(u => u.id === t.assignee) : null;
  const sprint = t.sprint ? sprints.find(s => s.id === t.sprint) : null;
  const out: any = { id: t.id, type: t.type, title: t.title, status: t.status };
  if (t.priority) out.priority = t.priority;
  if (typeof t.estimate === 'number') out.estimate = t.estimate;
  if (assignee) out.assignee = `@${assignee.username}`;
  if (sprint) out.sprint = sprint.name;
  if (t.labels && t.labels.length > 0) out.labels = t.labels;
  if (t.description && t.description.trim()) out.description = t.description;
  if (t.worktree) out.worktree = { path: t.worktree.path, branch: t.worktree.branch };
  if (t.dependsOn && t.dependsOn.length > 0) {
    out.dependsOn = allTickets
      ? t.dependsOn.map(d => {
          const dt = allTickets.find(x => x.id === d);
          return dt ? { id: d, title: dt.title, status: dt.status } : { id: d, missing: true };
        })
      : t.dependsOn;
  }
  return out;
}

export function workOnTicketPrompt(ticket: Ticket, users: User[], sprints: Sprint[], allTickets: Ticket[] = []): string {
  const ctx = compactTicket(ticket, users, sprints, allTickets);
  const noDescription = !ticket.description || !ticket.description.trim();
  const id = ticket.id;

  // Unmet deps = non-done referenced tickets. Missing ids treated as done (nothing to wait on).
  const unmetDeps = (ticket.dependsOn || [])
    .map(d => allTickets.find(t => t.id === d))
    .filter((t): t is Ticket => !!t && t.status !== 'done');

  const lines: string[] = [
    `# tkxr — Work on ticket ${id}`,
    ``,
  ];

  if (unmetDeps.length > 0) {
    lines.push(
      `**Blocked:** this ticket declares \`dependsOn\` and ${unmetDeps.length} of them ${unmetDeps.length === 1 ? 'is' : 'are'} not \`done\` yet:`,
      ...unmetDeps.map(d => `- \`${d.id}\` (${d.status}) — ${d.title}`),
      ``,
      `Do NOT start the work. Instead: call \`update_ticket_status\` with \`{ id: "${id}", status: "blocked" }\`, add a comment naming the deps you're waiting on, and return control. When the deps finish (\`done\`), re-run this prompt.`,
      ``,
    );
  }

  if (ticket.status === 'done') {
    lines.push(
      `**This ticket is already \`done\`.** Before touching anything, ask the user whether they want to reopen it and what the new scope is. Do not change status until they confirm. If they do reopen, follow the standard flow (progress → review/done) with \`update_ticket_status\`.`,
      ``,
      `## Ticket context`,
      '```json',
      JSON.stringify(ctx, null, 2),
      '```',
      ``,
      MCP_REMINDER,
    );
    return lines.join('\n');
  }

  if (ticket.worktree) {
    lines.push(
      `**Worktree:** \`${ticket.worktree.path}\` on branch \`${ticket.worktree.branch}\`.`,
      `\`cd\` there before doing any work — it's an isolated checkout so other tickets in progress won't collide with your commits.`,
      ``,
    );
  } else {
    lines.push(
      `**No worktree yet.** If this ticket is non-trivial (or other work may run in parallel), start with \`create_worktree\` (\`ticketId: "${id}"\`) — it makes a fresh branch + checkout so your commits don't collide with other in-flight work. Then \`cd\` there before editing files.`,
      ``,
    );
  }

  if (noDescription) {
    lines.push(
      `**Heads-up:** description is empty. Ask the user for context before starting anything non-obvious — the title alone is often not enough.`,
      ``,
    );
  }

  const flowByStatus: Record<string, string[]> = {
    backlog: [
      `Please pick this ticket up and drive it forward. Suggested flow:`,
      ``,
      `1. Fetch latest state — call \`get_ticket\` with \`id: "${id}"\` for the full description + comments.`,
      `2. Explore the repo — grep, read files, understand current state.`,
      `3. Mark it started — call \`update_ticket_status\` with \`{ id: "${id}", status: "progress" }\`.`,
      `4. Do the work.`,
      `5. When done — call \`update_ticket_status\` with \`status: "review"\` (or \`"done"\` if there's nothing to review), then \`add_comment\` summarising what you did + how to verify.`,
      `6. If you hit a blocker — \`update_ticket_status\` \`status: "blocked"\` + \`add_comment\` explaining what's needed.`,
    ],
    progress: [
      `This ticket is **already in progress** — you're continuing, not starting fresh. Suggested flow:`,
      ``,
      `1. Fetch latest state — call \`get_ticket\` with \`id: "${id}"\` and read the comment history to see what's been done and where the previous owner left off.`,
      `2. Explore the repo — check any recent changes tied to this ticket.`,
      `3. Continue the work.`,
      `4. When done — call \`update_ticket_status\` with \`status: "review"\` (or \`"done"\` if there's nothing to review), then \`add_comment\` summarising what you did + how to verify.`,
      `5. If you hit a blocker — \`update_ticket_status\` \`status: "blocked"\` + \`add_comment\` explaining what's needed.`,
    ],
    review: [
      `This ticket is **in review** — the goal here is to verify the work matches the ticket, not to reimplement. Suggested flow:`,
      ``,
      `1. Fetch latest state — call \`get_ticket\` with \`id: "${id}"\` and read the last comment(s) to see what the implementer says they did.`,
      `2. Check the actual repo — does the change work, is it complete, is it correct?`,
      `3. If it looks good — call \`update_ticket_status\` with \`{ id: "${id}", status: "done" }\` + \`add_comment\` noting what you verified.`,
      `4. If it needs more work — call \`update_ticket_status\` with \`status: "progress"\` + \`add_comment\` describing what's missing.`,
      `5. If something is unclear — \`add_comment\` asking the question; leave the status alone.`,
    ],
    blocked: [
      `This ticket is **blocked**. Read the comment history first to understand the block before assuming you can just work on it. Suggested flow:`,
      ``,
      `1. Fetch latest state — call \`get_ticket\` with \`id: "${id}"\` and read every comment.`,
      `2. Identify the blocker: dependency, missing decision, external system, etc.`,
      `3. If you can resolve it — do so, then \`update_ticket_status\` \`status: "progress"\` + \`add_comment\` noting the unblock.`,
      `4. If you cannot — \`add_comment\` describing what you learned and what's still needed. Leave the status as \`blocked\`.`,
    ],
  };

  lines.push(...flowByStatus[ticket.status], ``);
  lines.push(
    `## Ticket context`,
    '```json',
    JSON.stringify(ctx, null, 2),
    '```',
    ``,
    MCP_REMINDER,
  );

  return lines.join('\n');
}

export function ticketAskPrompt(question: string, ticket: Ticket, users: User[], sprints: Sprint[], allTickets: Ticket[] = []): string {
  const ctx = compactTicket(ticket, users, sprints, allTickets);
  return [
    `# tkxr — Ticket question`,
    ``,
    `Ticket \`${ticket.id}\`: **${ticket.title}**`,
    ``,
    `## Question`,
    question,
    ``,
    `## Ticket context`,
    '```json',
    JSON.stringify(ctx, null, 2),
    '```',
    ``,
    MCP_REMINDER,
  ].join('\n');
}

export interface TriageScope {
  sprint?: Sprint | null;
  user?: User | null;
}

export function triagePrompt(tickets: Ticket[], users: User[], sprints: Sprint[], scope: TriageScope = {}): string {
  const open = tickets.filter(t => t.status !== 'done');
  const projection = open.map(t => {
    const a = t.assignee ? users.find(u => u.id === t.assignee) : null;
    const s = t.sprint ? sprints.find(sp => sp.id === t.sprint) : null;
    return {
      id: t.id,
      type: t.type,
      title: t.title,
      status: t.status,
      priority: t.priority || null,
      estimate: t.estimate ?? null,
      assignee: a ? `@${a.username}` : null,
      sprint: s ? s.name : null,
    };
  });

  const scopeLine = scope.sprint
    ? `Scope: sprint "${scope.sprint.name}" (${scope.sprint.status}).`
    : scope.user
      ? `Scope: assignee @${scope.user.username}.`
      : `Scope: entire open backlog.`;

  return [
    `# tkxr — Triage`,
    ``,
    scopeLine,
    ``,
    `Please triage the tickets below. Look for:`,
    `- **Unowned open tickets** — assign or flag.`,
    `- **Missing priorities** — infer from title/context, edit if confident.`,
    `- **Stale in-progress** — nudge status or add a comment asking for a status update.`,
    `- **Missing sprint** — attach to the active sprint if the ticket clearly belongs.`,
    `- **Sprint balance** — if a sprint is overloaded or empty, suggest a rebalance.`,
    `- **Critical bugs still open** — call them out.`,
    ``,
    `For each finding, either apply the change via tkxr MCP tools (\`edit_ticket\`, \`assign_ticket\`, \`update_ticket_status\`, \`add_comment\`, \`set_ticket_sprint\`) or list it as a recommendation if you're not sure.`,
    ``,
    `Use \`get_ticket\` to fetch full descriptions + comments before making non-trivial edits.`,
    ``,
    `## Tickets (${projection.length} open)`,
    '```json',
    JSON.stringify(projection, null, 2),
    '```',
    ``,
    MCP_REMINDER,
  ].join('\n');
}

export function orchestrateSprintPrompt(sprint: Sprint, tickets: Ticket[], users: User[]): string {
  const scoped = tickets.filter(t => t.sprint === sprint.id && t.status !== 'done');
  const scopedIds = new Set(scoped.map(t => t.id));
  const projection = scoped.map(t => {
    const a = t.assignee ? users.find(u => u.id === t.assignee) : null;
    const compact: any = {
      id: t.id,
      type: t.type,
      title: t.title,
      status: t.status,
      priority: t.priority || null,
      estimate: t.estimate ?? null,
      assignee: a ? `@${a.username}` : null,
    };
    if (t.worktree) compact.worktree = { path: t.worktree.path, branch: t.worktree.branch };
    if (t.dependsOn && t.dependsOn.length > 0) {
      compact.dependsOn = t.dependsOn.map(d => {
        const dt = tickets.find(x => x.id === d);
        if (!dt) return { id: d, missing: true };
        return {
          id: d,
          status: dt.status,
          inThisSprint: scopedIds.has(d) || dt.sprint === sprint.id,
        };
      });
    }
    return compact;
  });

  const hasSprintWorktree = !!sprint.worktree;
  const wtPath = sprint.worktree?.path || '<sprint worktree path>';
  const wtBranch = sprint.worktree?.branch || `tkxr/sprint/${sprint.id}`;

  return [
    `# tkxr — Orchestrate sprint "${sprint.name}" (${sprint.id})`,
    ``,
    `You are the **orchestrator** for this sprint. Your job is not to write code — it is to fan out sub-agents (one per ticket), then merge their branches into the sprint feature branch as they finish. At the end you hand back a single unified branch ready for review.`,
    ``,
    `## Rule zero: exclusive git writer`,
    `You are the ONLY agent that touches the sprint worktree's git state. Sub-agents work in per-ticket worktrees on per-ticket branches. Merges happen in the sprint worktree. Never fan out a sub-agent whose worktree overlaps with yours.`,
    ``,
    `## Setup`,
    hasSprintWorktree
      ? `The sprint already has a worktree: \`${wtPath}\` on branch \`${wtBranch}\`. \`cd\` there — that's your workspace for the entire orchestration.`
      : `1. Create the sprint worktree — call \`create_sprint_worktree\` with \`{ sprintId: "${sprint.id}" }\`. Default: branch \`tkxr/sprint/${sprint.id}\` at \`<repo-parent>/<repo>-worktrees/sprints/${sprint.id}\`.\n2. \`cd\` into the returned path.`,
    ``,
`## Plan the fan-out (dependency-aware)`,
    `Before spawning anything, build a plan:`,
    ``,
    `1. Build a dep graph from each ticket's \`dependsOn\` list PLUS a scan of ticket descriptions/comments for references to other ticket ids (\`tas-*\`, \`bug-*\`).`,
    `2. Topologically sort. If you find a cycle, stop and escalate to the human — do not attempt to break it silently.`,
    `3. Wave 1 = tickets whose deps are all \`done\` (or missing / outside this sprint and clearly resolved). Wave 2 = tickets that only depend on Wave 1. And so on.`,
    `4. For any ticket in Wave 2+, immediately: \`update_ticket_status\` to \`blocked\` + \`add_comment\` listing the deps it waits on. Do not fan out yet.`,
    ``,
    `## Fan out — wave by wave`,
    `For each ticket in the current wave, spawn a sub-agent via the **Task tool**. Send each sub-agent the prompt below (substitute the ticket id + sprint branch):`,
    ``,
    '```',
    `Work on tkxr ticket <TICKET_ID>.`,
    ``,
    `1. Call \`get_ticket\` first. If the response has a non-empty \`blockedBy\` list, STOP: call \`update_ticket_status\` with \`status: "blocked"\`, \`add_comment\` naming the deps, and return control. The orchestrator will re-fan you when unblocked.`,
    `2. Otherwise: call \`create_worktree\` with \`{ ticketId: "<TICKET_ID>" }\` — base defaults to the sprint branch (\`${wtBranch}\`) automatically.`,
    `3. cd into the returned path. Do NOT touch any other directory.`,
    `4. Re-read the ticket + comments if needed. Look at the actual repo.`,
    `5. Call \`update_ticket_status\` with \`{ id: "<TICKET_ID>", status: "progress" }\`.`,
    `6. Do the work. Commit on your ticket branch. Do NOT merge, rebase against the sprint branch, or push.`,
    `7. When done: call \`update_ticket_status\` with \`status: "review"\`, then \`add_comment\` summarising what changed and how to verify.`,
    `8. Return control to the orchestrator with the ticket id + branch name.`,
    '```',
    ``,
    `Fan out as many sub-agents in parallel as you like. Each has its own worktree + branch, so they won't collide.`,
    ``,
    `## Integrate (in the sprint worktree)`,
    `As each sub-agent reports back with a ticket in \`review\`:`,
    ``,
    `1. Verify with \`get_ticket\` that status is \`review\` and the ticket branch is set. Also check \`blockedBy\` in the response — sanity check that nothing regressed.`,
    `2. From the sprint worktree, run \`git merge --no-ff <ticket-branch> -m "Merge <ticket-id>: <ticket-title>"\`.`,
    `3. **On merge conflict**: \`git merge --abort\`. Call \`add_comment\` on the ticket describing the conflicting paths + which other ticket(s) collided with it. Set status back to \`progress\` and re-fan a sub-agent to resolve — instruct the sub-agent to pull the latest sprint branch into its worktree first (\`git pull --rebase origin ${wtBranch}\` or \`git rebase ${wtBranch}\`), OR escalate to the human. Do not force anything.`,
    `4. **On clean merge**: \`update_ticket_status\` to \`done\` (this auto-removes the ticket worktree if clean). If you kept the ticket branch and want to prune it: \`git branch -d <ticket-branch>\`.`,
    `5. **After each done**: re-scan blocked tickets in this sprint. For any whose \`dependsOn\` are now all \`done\`, transition them back to \`backlog\` + \`add_comment\` noting the unblock, then fan out a sub-agent for it.`,
    ``,
    `## Finish`,
    `When every ticket is either \`done\` or explicitly deferred:`,
    `- Report the sprint branch (\`${wtBranch}\`) and its HEAD.`,
    `- List any tickets left unresolved with a short reason.`,
    `- The human takes it from there (PR to main, further review, etc.).`,
    ``,
    `Optionally, when the sprint work is fully merged upstream, call \`remove_sprint_worktree\` with \`{ sprintId: "${sprint.id}", keepBranch: true }\` to prune the checkout while preserving the branch history.`,
    ``,
    `## Sprint context`,
    '```json',
    JSON.stringify({
      id: sprint.id,
      name: sprint.name,
      goal: sprint.goal || null,
      status: sprint.status,
      worktree: sprint.worktree ? { path: sprint.worktree.path, branch: sprint.worktree.branch } : null,
      openTicketCount: projection.length,
      tickets: projection,
    }, null, 2),
    '```',
    ``,
    MCP_REMINDER,
  ].join('\n');
}

export function sprintBreakdownPrompt(sprint: Sprint, existingTickets: Ticket[], users: User[]): string {
  const scoped = existingTickets.filter(t => t.sprint === sprint.id);
  const scopedProjection = scoped.map(t => {
    const a = t.assignee ? users.find(u => u.id === t.assignee) : null;
    const out: any = {
      id: t.id,
      type: t.type,
      title: t.title,
      status: t.status,
      priority: t.priority || null,
      estimate: t.estimate ?? null,
      assignee: a ? `@${a.username}` : null,
    };
    if (t.labels && t.labels.length > 0) out.labels = t.labels;
    if (t.description && t.description.trim()) out.description = t.description;
    if (t.dependsOn && t.dependsOn.length > 0) out.dependsOn = t.dependsOn;
    return out;
  });
  const userProjection = users.map(u => ({ id: u.id, username: `@${u.username}`, displayName: u.displayName }));

  const anchorTicketId = scoped.length > 0 ? scoped[0].id : null;

  const hasWorktree = !!sprint.worktree;
  const wtPath = sprint.worktree?.path || '<sprint worktree path>';

  return [
    `# tkxr — Plan sprint "${sprint.name}" (${sprint.id})`,
    ``,
    `You are the **sprint planner**. Your job is to turn the sprint's goal into a concrete set of child tickets — no code, no status flips on existing work. Just research, then create tickets.`,
    ``,
    hasWorktree
      ? `The sprint has a worktree at \`${wtPath}\`. \`cd\` there so any repo exploration reflects the sprint branch.`
      : `The sprint has no worktree yet — that's fine. Run your repo research against the current checkout.`,
    ``,
    `## Sprint goal`,
    sprint.goal ? sprint.goal : `(no goal set — STOP and ask the user for one before doing anything.)`,
    ``,
    `## Suggested flow`,
    `1. Re-read the sprint goal above. If it's ambiguous, one-line-summarise your interpretation and ASK the user to confirm before creating anything. Do not guess silently.`,
    `2. Read every ticket already attached to the sprint (see JSON below) so you don't duplicate scope.`,
    `3. Explore the repo with your own tools — grep, read files, check package.json / docs / relevant modules. Ground the breakdown in what actually exists.`,
    `4. Design the breakdown:`,
    `   - Aim for the smallest set of tickets that fully covers the goal.`,
    `   - **Hard cap: 12 new tickets.** If you're tempted to go past that, stop and ask the user how to scope down.`,
    `   - Each ticket should be independently reviewable (one branch, one merge).`,
    `   - Split into **waves** using \`dependsOn\`: Wave 1 = no deps, Wave 2 = depends only on Wave 1, etc. This lets the orchestrator fan them out in parallel per wave.`,
    `5. For each proposed ticket, call \`create_ticket\` (MCP) exactly once with:`,
    `   - \`title\`: short, imperative.`,
    `   - \`description\`: enough context for another agent to pick it up cold — reference specific files/functions when possible.`,
    `   - \`type\`: \`task\` (default) or \`bug\` if you're capturing a defect uncovered during research.`,
    `   - \`sprint\`: \`"${sprint.id}"\` — always, so it lands in this sprint.`,
    `   - \`estimate\`: story points (1 = trivial, 2 = half day, 3 = day, 5 = multi-day, 8 = week-ish).`,
    `   - \`priority\`: \`low\` | \`medium\` | \`high\` | \`critical\`.`,
    `   - \`labels\`: reuse existing labels where sensible (see attached tickets for patterns).`,
    `   - \`dependsOn\`: array of the ids of other **new tickets you just created** that must land first. Only reference ticket ids you know exist (i.e. previous \`create_ticket\` return values or already-attached tickets).`,
    `   - Do NOT set \`assignee\` unless a user obviously owns the area — leave it null for the human to route.`,
    `6. Post ONE summary comment on ${anchorTicketId ? `the sprint's first ticket (\`${anchorTicketId}\`)` : `a dedicated "plan" ticket you create first (title: "Sprint plan: ${sprint.name}", type: task, priority: medium)`} via \`add_comment\`. The comment should:`,
    `   - List each wave and which ticket ids belong to it.`,
    `   - Give a one-line reasoning for the wave ordering.`,
    `   - Call out any assumptions you made about the goal.`,
    ``,
    `## Guardrails (non-negotiable)`,
    `- Do NOT edit or delete any existing ticket. No \`edit_ticket\`, no \`delete_ticket\`.`,
    `- Do NOT call \`update_ticket_status\` on anything — new or existing. New tickets start in \`backlog\` by default; that's correct.`,
    `- Do NOT create the sprint or change sprint metadata. It already exists.`,
    `- Do NOT assign yourself or others; leave routing to the human.`,
    `- If the goal is ambiguous, contradictory, or already fully covered by existing tickets, STOP and ask before creating anything.`,
    `- Cap: ~12 new tickets. Fewer is better.`,
    ``,
    `## Sprint context`,
    '```json',
    JSON.stringify({
      id: sprint.id,
      name: sprint.name,
      goal: sprint.goal || null,
      status: sprint.status,
      worktree: sprint.worktree ? { path: sprint.worktree.path, branch: sprint.worktree.branch } : null,
      existingTicketCount: scopedProjection.length,
      existingTickets: scopedProjection,
    }, null, 2),
    '```',
    ``,
    `## Users (for reference — do NOT auto-assign)`,
    '```json',
    JSON.stringify(userProjection, null, 2),
    '```',
    ``,
    MCP_REMINDER,
  ].join('\n');
}

export function sprintPlanPrompt(sprints: Sprint[], tickets: Ticket[], users: User[]): string {
  const backlog = tickets.filter(t => t.status === 'backlog' && !t.sprint);
  const projection = backlog.map(t => {
    const a = t.assignee ? users.find(u => u.id === t.assignee) : null;
    return {
      id: t.id,
      type: t.type,
      title: t.title,
      priority: t.priority || null,
      estimate: t.estimate ?? null,
      assignee: a ? `@${a.username}` : null,
    };
  });
  const totalPts = backlog.reduce((s, t) => s + (t.estimate || 0), 0);
  return [
    `# tkxr — Draft next sprint`,
    ``,
    `Backlog: ${backlog.length} tickets, ${totalPts} pts total.`,
    ``,
    `Please:`,
    `1. Create a planning sprint via \`create_sprint\` with an inferred name + goal.`,
    `2. Select tickets that balance to a reasonable capacity (aim ~half the backlog pts, min 8).`,
    `3. For each selection, use \`set_ticket_sprint\` to attach it.`,
    `4. Prefer high-priority + short-effort tickets; keep bugs before tasks at equal priority.`,
    ``,
    `## Backlog`,
    '```json',
    JSON.stringify(projection, null, 2),
    '```',
    ``,
    MCP_REMINDER,
  ].join('\n');
}
