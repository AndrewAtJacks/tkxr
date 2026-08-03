import type { Epic, Ticket, User, Sprint } from './stores';

const MCP_REMINDER = `Use the tkxr MCP tools if attached (agent_guide, get_ticket, list_tickets, search_tickets, edit_ticket, update_ticket_status, assign_ticket, add_comment, set_ticket_sprint). If a change is warranted, apply it via the MCP tools so the web UI live-refreshes.`;

// Repo-wide convention: every code commit uses Conventional Commits —
// https://www.conventionalcommits.org/. Shared block so every prompt that can
// end in a commit speaks the same language. Committing is the implementer's job
// on their own ticket branch; there is no agent action that commits on their
// behalf (docs/branching-model.md).
export const CONVENTIONAL_COMMIT_GUIDE = [
  `## Commit convention (Conventional Commits — mandatory)`,
  ``,
  `All commits produced from tkxr flows follow Conventional Commits. Subject:`,
  ``,
  `\`\`\``,
  `<type>(<scope>): <imperative subject> (<ticket-id>)`,
  `\`\`\``,
  ``,
  `- **type** — infer from the ticket + diff:`,
  `  - \`feat\` — new user-facing behavior (default for tickets with \`type: task\` that add capability).`,
  `  - \`fix\` — bug repair (default for tickets with \`type: bug\`).`,
  `  - \`docs\` — docs-only.`,
  `  - \`refactor\` — no behavior change.`,
  `  - \`test\` — tests-only.`,
  `  - \`chore\` — tooling / build / infra. Use for merge commits: \`chore(merge)\`.`,
  `  - \`perf\`, \`style\`, \`build\`, \`ci\` — as applicable.`,
  `- **scope** — the primary directory or subsystem touched (e.g. \`web\`, \`claude-cli\`, \`mcp\`, \`core\`, \`docs\`). One word. Omit only if the change is genuinely cross-cutting.`,
  `- **subject** — imperative, lower-case, no trailing period, ≤72 chars incl. type/scope/ticket-id suffix.`,
  `- **ticket-id suffix** — append \`(<ticket-id>)\` so the commit is greppable back to the ticket. Skip only if there is genuinely no ticket (rare).`,
  ``,
  `Body (optional, wrap at ~72 cols):`,
  `- **Why** — the motivation from the ticket description, not "what changed" (the diff shows that).`,
  `- **Notes** — any migration steps, follow-ups, or reviewer heads-ups.`,
  `- Do NOT include marketing prose, emoji, or "Generated with…" trailers.`,
  ``,
  `Examples:`,
  `- \`feat(web): add commit-with-claude action on in-review tickets (tas-ZGctzRaH)\``,
  `- \`fix(claude-cli): force non-interactive execution (bug-I30c9l0_)\``,
  `- \`chore(merge): tas-abc123 add sprint planner\` (for merge commits)`,
  ``,
  `Merges: use \`chore(merge): <ticket-id> <short title>\` as the merge subject — e.g. landing a ticket branch on its epic branch. Keep \`--no-ff\`.`,
].join('\n');

// Prepended ONLY when the prompt is spawned into tkxr's server-side runner
// (see `runPrompt` in claudeRun.ts). Keeps the CLI from stalling on approval /
// plan-mode gates when nobody is at a keyboard. Paired with
// `--permission-mode bypassPermissions` on the spawn side (bug-I30c9l0_).
//
// Deliberately NOT part of the prompt bodies below: when the prompt is copied
// to the clipboard (tas-abV4MtD8) it lands in an interactive Claude session
// where a human *can* approve tools and answer questions, so the directive is
// both false and harmful there.
const EXECUTION_DIRECTIVE = [
  `**Execution mode — READ FIRST.**`,
  `You are running headless inside tkxr's server-side runner. There is no human at a keyboard to approve tool calls or exit plan mode. Rules:`,
  `- Execute directly. Do NOT enter plan mode. Do NOT emit an ExitPlanMode call.`,
  `- Do NOT ask for permission before using tools — you have been granted full permissions for this session.`,
  `- Nobody can answer mid-run, so a clarifying question ends the turn. If something is ambiguous, do the parts that don't depend on the answer, state the assumption you made, and put the open question in your final message.`,
  `- When you're done, exit; the transcript is streamed back to the human.`,
].join('\n');

/**
 * Attach the headless execution directive to a prompt body. Call this only on
 * the spawn path — copied/pasted prompts must stay directive-free.
 */
export function withExecutionDirective(body: string): string {
  return `${EXECUTION_DIRECTIVE}\n\n---\n\n${body}`;
}

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
  if (ticket.status !== 'review') {
    // Reviewers verify, they don't commit — the convention block is only relevant
    // to the flows that will actually produce commits.
    lines.push(CONVENTIONAL_COMMIT_GUIDE, ``);
  }
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

export function commitTicketPrompt(ticket: Ticket, users: User[], sprints: Sprint[], allTickets: Ticket[] = []): string {
  const ctx = compactTicket(ticket, users, sprints, allTickets);
  const id = ticket.id;
  const wtPath = ticket.worktree?.path;
  const wtBranch = ticket.worktree?.branch;

  const lines: string[] = [
    `# tkxr — Commit review work for ticket ${id}`,
    ``,
    `This ticket is in **review**. Your job: stage the correct changes on its worktree and land ONE Conventional Commit summarising the work. No new implementation, no refactors — just a commit.`,
    ``,
  ];

  if (wtPath && wtBranch) {
    lines.push(
      `**Worktree:** \`${wtPath}\` on branch \`${wtBranch}\`. \`cd\` there before running any git command — commits MUST land on this branch, not the parent checkout.`,
      ``,
    );
  } else {
    lines.push(
      `**No worktree recorded on this ticket.** Before committing, ask the user which working tree to commit in — do NOT commit into the shared main checkout without confirmation.`,
      ``,
    );
  }

  lines.push(
    `## Suggested flow`,
    ``,
    `1. \`cd\` into the ticket worktree${wtPath ? ` (\`${wtPath}\`)` : ''}.`,
    `2. \`git status\` and \`git diff\` (plus \`git diff --staged\`) to inventory what actually changed. If there is nothing to commit, STOP: \`add_comment\` on the ticket saying the tree is clean and return control — don't create an empty commit.`,
    `3. Determine the scope: which directory/subsystem dominates the diff? That's your \`<scope>\`. If changes are split, pick the most representative and mention the others in the body.`,
    `4. Stage the correct files — prefer \`git add <path>...\` over \`git add -A\`. Skip unrelated cruft (editor swap files, .env, node_modules diff noise). If unrelated changes exist, leave them unstaged and mention it in the ticket comment (step 8).`,
    `5. Craft the commit message per the convention below. Type comes from the ticket + diff (\`task\` → \`feat\` unless the diff says otherwise; \`bug\` → \`fix\`). Subject is imperative, ≤72 chars including \`<type>(<scope>): \` and the trailing \`(${id})\`.`,
    `6. Body: one short paragraph explaining WHY, sourced from the ticket description — not a diff summary. Wrap at ~72 cols. No "Generated with…" trailer.`,
    `7. Run \`git commit -m "<subject>" -m "<body>"\` (use two \`-m\` flags so subject/body separate cleanly; use a single-quoted PowerShell here-string \`@'…'@\` on Windows if the body has special chars). Do NOT push, do NOT merge, do NOT amend anything already on the branch.`,
    `8. On success: \`add_comment\` on ${id} with the commit subject + short hash (from \`git rev-parse --short HEAD\`) so the reviewer can find it. Leave status as \`review\` — the human decides when to mark \`done\`.`,
    `9. On any failure (hook rejects, pre-commit lint, etc.): do NOT bypass with \`--no-verify\`. Fix the underlying issue if trivial, otherwise \`update_ticket_status\` to \`blocked\` + \`add_comment\` naming the exact failure.`,
    ``,
    CONVENTIONAL_COMMIT_GUIDE,
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

/**
 * Break an epic's goal into child tickets.
 *
 * This is where planning lives. There is no sprint equivalent: a sprint frames
 * concurrent work and has no goal worth decomposing, while an epic has both a
 * goal and a bounded ticket set (see `docs/branching-model.md`).
 */
export function epicBreakdownPrompt(epic: Epic, existingTickets: Ticket[], users: User[]): string {
  const scoped = existingTickets.filter(t => t.epic === epic.id);
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
  const wtPath = epic.worktree?.path;

  return [
    `# tkxr — Plan epic "${epic.name}" (${epic.id})`,
    ``,
    `You are the **epic planner**. Your job is to turn this epic's goal into a concrete set of child tickets — no code, no status flips on existing work. Just research, then create tickets.`,
    ``,
    wtPath
      ? `The epic has a worktree at \`${wtPath}\`. \`cd\` there so any repo exploration reflects the epic branch.`
      : `The epic has no worktree yet — that's fine. Run your repo research against the current checkout.`,
    ``,
    `## Epic goal`,
    epic.goal ? epic.goal : `(no goal set — STOP and ask the user for one before doing anything.)`,
    ``,
    `## Suggested flow`,
    `1. Re-read the goal above. If it's ambiguous, one-line-summarise your interpretation and ASK the user to confirm before creating anything. Do not guess silently.`,
    `2. Read every ticket already in the epic so you don't duplicate scope. The JSON below is the panel's own slice and is capped, so confirm it with \`get_epic\` (\`{ id: "${epic.id}" }\`), which returns the epic's full ticket list, before concluding something isn't covered.`,
    `3. Explore the repo with your own tools — grep, read files, check package.json / docs / relevant modules. Ground the breakdown in what actually exists.`,
    `4. Design the breakdown:`,
    `   - Aim for the smallest set of tickets that fully covers the goal.`,
    `   - **Hard cap: 12 new tickets.** If you're tempted to go past that, stop and ask the user how to scope down.`,
    `   - Each ticket should be independently reviewable (one branch, one merge).`,
    `   - Split into **waves** using \`dependsOn\`: Wave 1 = no deps, Wave 2 = depends only on Wave 1, etc.`,
    `5. Create the tickets **wave by wave** — every Wave 1 ticket before any Wave 2 ticket, and so on. \`dependsOn\` is set at creation and you may not \`edit_ticket\` afterwards, so anything created before the tickets it depends on can never be wired up. For each proposed ticket, call \`create_ticket\` (MCP) exactly once with:`,
    `   - \`title\`: short, imperative.`,
    `   - \`description\`: enough context for another agent to pick it up cold — reference specific files/functions when possible.`,
    `   - \`type\`: \`task\` (default) or \`bug\` if you're capturing a defect uncovered during research.`,
    `   - \`epic\`: \`"${epic.id}"\` — always, so it lands in this epic.`,
    epic.sprint
      ? `   - \`sprint\`: \`"${epic.sprint}"\` — the epic's workspace. The board is sprint-scoped, so a ticket without it won't appear alongside the epic.`
      : `   - \`sprint\`: leave unset — this epic belongs to no sprint, so its tickets live in the Unsorted workspace.`,
    `   - \`estimate\`: story points (1 = trivial, 2 = half day, 3 = day, 5 = multi-day, 8 = week-ish).`,
    `   - \`priority\`: \`low\` | \`medium\` | \`high\` | \`critical\`.`,
    `   - \`dependsOn\`: array of the ids of other **new tickets you just created** that must land first.`,
    `   - Do NOT set \`assignee\` unless a user obviously owns the area — leave it null for the human to route.`,
    `6. Post ONE summary comment on ${anchorTicketId ? `the epic's first ticket (\`${anchorTicketId}\`)` : `a dedicated "plan" ticket you create first (title: "Epic plan: ${epic.name}", type: task, priority: medium)`} via \`add_comment\`. List each wave and its ticket ids, give a one-line reasoning for the ordering, and call out any assumptions you made about the goal.`,
    ``,
    `## Guardrails (non-negotiable)`,
    `- Do NOT edit or delete any existing ticket. No \`edit_ticket\`, no \`delete_ticket\`.`,
    `- Do NOT call \`update_ticket_status\` on anything — new or existing. New tickets start in \`backlog\` by default; that's correct.`,
    `- Do NOT create the epic or change epic metadata. It already exists.`,
    `- Do NOT assign yourself or others; leave routing to the human.`,
    `- If the goal is ambiguous, contradictory, or already fully covered by existing tickets, STOP and ask before creating anything.`,
    `- Cap: ~12 new tickets. Fewer is better.`,
    ``,
    `## Epic context`,
    '```json',
    JSON.stringify({
      id: epic.id,
      name: epic.name,
      goal: epic.goal || null,
      status: epic.status,
      sprint: epic.sprint || null,
      worktree: epic.worktree ? { path: epic.worktree.path, branch: epic.worktree.branch } : null,
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

/**
 * Review every branch belonging to an epic in one pass.
 *
 * Reviewing ticket by ticket misses the defects that only exist between
 * tickets — two tickets solving the same problem twice, one ticket's change
 * silently invalidating another's assumption, a convention applied in three of
 * four places. An epic is the unit that maps to a feature branch, so it is also
 * the smallest unit where the whole change is visible at once.
 *
 * `baseBranch` is what the epic branch forked from (its workspace's sprint
 * branch, or null to mean the repo default) — passed in because the panel knows
 * the sprint and this module deliberately has no storage access.
 */
export function epicReviewPrompt(
  epic: Epic,
  existingTickets: Ticket[],
  users: User[],
  baseBranch: string | null,
): string {
  const scoped = existingTickets.filter(t => t.epic === epic.id);
  const withBranches = scoped.filter(t => !!t.worktree);
  const anchorTicketId = scoped.length > 0 ? scoped[0].id : null;

  const projection = scoped.map(t => {
    const a = t.assignee ? users.find(u => u.id === t.assignee) : null;
    const out: any = {
      id: t.id,
      type: t.type,
      title: t.title,
      status: t.status,
      assignee: a ? `@${a.username}` : null,
    };
    if (t.description && t.description.trim()) out.description = t.description;
    if (t.worktree) out.branch = t.worktree.branch;
    return out;
  });

  const epicBranch = epic.worktree?.branch || null;
  const base = baseBranch || 'the repo default branch (main)';

  return [
    `# tkxr — Review the code for epic "${epic.name}" (${epic.id})`,
    ``,
    `You are the **reviewer** for this epic. Review only: do not fix anything, do not commit, do not change any ticket's status. Your output is findings.`,
    ``,
    `## What to review`,
    epic.worktree
      ? `The epic branch \`${epicBranch}\` at \`${epic.worktree.path}\`. \`cd\` there first. Its base is \`${base}\`, so the epic's own work is \`git diff ${baseBranch || '<default-branch>'}...${epicBranch}\`.`
      : withBranches.length > 0
        ? `This epic has **no worktree**, so there is no single branch holding its work. Review the ticket branches listed below instead, each against \`${base}\`.`
        : `This epic has **no worktree**, and none of its tickets have branches either.`,
    withBranches.length > 0
      ? `\nTicket branches under this epic — some may not be merged into the epic branch yet, so check each one and say which are outstanding:\n${withBranches.map(t => `- \`${t.worktree!.branch}\` — ${t.id} (${t.status}) ${t.title}`).join('\n')}`
      : epic.worktree
        ? `\nNo ticket in this epic has its own branch, so the epic branch is the whole story.`
        // The panel disables the button in this state, but the export is
        // callable without it — say plainly that there is nothing here rather
        // than sending someone to review a branch list that doesn't exist.
        : `\n**There is nothing to review.** This epic has neither a worktree nor any ticket branches, so no code is associated with it yet. Report that and stop — do not go looking for uncommitted changes in the main checkout.`,
    ``,
    `Use \`git log\`, \`git diff\`, and \`git merge-base\` to establish what is actually included before you review it. If a ticket branch has commits the epic branch does not, review it separately and label the finding with that branch — otherwise you will report on code nobody is about to merge, or miss code that is.`,
    ``,
    `## What to look for`,
    `1. **Correctness** — real defects: wrong logic, unhandled errors, races, off-by-one, broken edge cases. Give a concrete failing input or sequence for each, not a category.`,
    `2. **Ticket fidelity** — for each ticket below, does the code actually do what the ticket describes? Call out anything claimed-but-missing and anything shipped that no ticket asked for.`,
    `3. **Cross-ticket problems** — the reason this is an epic-wide review and not N ticket reviews. Look for: the same helper written twice, one ticket's change invalidating another's assumption, a convention followed in some places and not others, and dead code left by a later ticket superseding an earlier one.`,
    `4. **Tests** — what is untested that would have caught a defect you found. Do not ask for coverage for its own sake.`,
    `5. **Docs** — README / CHANGELOG / agent guide claims that the code no longer supports.`,
    ``,
    `Skip style and formatting unless the repo has a stated convention being broken. Report what is wrong, not what is merely different from your taste.`,
    ``,
    `## How to report`,
    `- **Per-ticket findings** → \`add_comment\` on that ticket. Lead with the file and line, then the defect, then a concrete fix. One comment per ticket, not one per finding.`,
    anchorTicketId
      ? `- **Summary** → one \`add_comment\` on \`${anchorTicketId}\`: what you reviewed (branches + commit range), the findings ranked most-severe first, and an explicit verdict — is this epic mergeable as it stands?`
      : `- **Summary** → this epic has no tickets to comment on, so return the summary in your final message instead.`,
    `- If you found nothing real, say so plainly. Do not pad the list to look thorough.`,
    ``,
    `## Guardrails (non-negotiable)`,
    `- Do NOT edit, stage, commit, merge, rebase, or push anything.`,
    `- Do NOT call \`update_ticket_status\` — the human decides what a review means for a ticket's state.`,
    `- Do NOT create or delete tickets. If a finding deserves its own ticket, say so in the summary and let the human file it.`,
    `- Verify before you report: read the surrounding code, and prefer running the thing over reasoning about it. A confident wrong finding costs more than a missed one.`,
    ``,
    `## Epic context`,
    '```json',
    JSON.stringify({
      id: epic.id,
      name: epic.name,
      goal: epic.goal || null,
      status: epic.status,
      sprint: epic.sprint || null,
      worktree: epic.worktree ? { path: epic.worktree.path, branch: epic.worktree.branch } : null,
      baseBranch: baseBranch || null,
      ticketCount: projection.length,
      tickets: projection,
    }, null, 2),
    '```',
    ``,
    `The ticket list above is the panel's own slice and is capped — confirm it with \`get_epic\` (\`{ id: "${epic.id}" }\`) before concluding a branch has no ticket behind it.`,
    ``,
    MCP_REMINDER,
  ].join('\n');
}

/**
 * Group a sprint's ungrouped backlog into epics.
 *
 * This is the *only* sprint-level agent action. A sprint frames concurrent work,
 * so the one useful thing to do at that level is triage: look at everything in
 * flight and sort it into features. Every other sprint-level prompt — plan,
 * orchestrate, commit — was removed when epics took over as the unit of work
 * (see `docs/branching-model.md`).
 */
export function epicPlanPrompt(sprint: Sprint | null, tickets: Ticket[], users: User[]): string {
  const ungrouped = tickets.filter(t => t.status === 'backlog' && !t.epic);
  const projection = ungrouped.map(t => {
    const a = t.assignee ? users.find(u => u.id === t.assignee) : null;
    return {
      id: t.id,
      type: t.type,
      title: t.title,
      priority: t.priority || null,
      estimate: t.estimate ?? null,
      assignee: a ? `@${a.username}` : null,
      description: t.description && t.description.trim() ? t.description : null,
    };
  });
  const totalPts = ungrouped.reduce((s, t) => s + (t.estimate || 0), 0);
  const scopeLine = sprint
    ? `Workspace: sprint "${sprint.name}" (\`${sprint.id}\`).`
    : `Workspace: Unsorted — these tickets belong to no sprint.`;

  return [
    `# tkxr — Group the backlog into epics`,
    ``,
    scopeLine,
    `Ungrouped backlog: ${ungrouped.length} tickets, ${totalPts} pts total.`,
    ``,
    `These tickets sit in the workspace with no epic, so the board reads as a flat list instead of work streams. Your job is to bucket them — no code, no status changes.`,
    ``,
    `## Suggested flow`,
    `1. Read the titles + descriptions below and look for genuine themes (feature areas, subsystems, initiatives). Explore the repo if a title is ambiguous.`,
    `2. Create an epic per theme via \`create_epic\`: \`name\` (short), \`goal\` (one line)${sprint ? `, \`sprint: "${sprint.id}"\` so it lands in this workspace` : ''}.`,
    `3. Attach each ticket with \`set_ticket_epic\`.`,
    `4. Leave genuinely one-off tickets ungrouped — a one-ticket epic is noise.`,
    ``,
    `## Guardrails`,
    `- **Cap: 5 new epics.** Fewer is better; if you need more, stop and ask.`,
    `- Do NOT change ticket status, priority, estimate, or assignee.`,
    `- Do NOT create or delete tickets.`,
    `- Reuse an existing epic if one already fits — check \`list_epics\` first.`,
    ``,
    `## Ungrouped backlog`,
    '```json',
    JSON.stringify(projection, null, 2),
    '```',
    ``,
    MCP_REMINDER,
  ].join('\n');
}
