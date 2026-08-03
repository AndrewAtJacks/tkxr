# Branching model: epics own feature branches, sprints own nothing

**Status:** adopted. Supersedes the answer given to question 3 of `tas-IK2HcQWo`.
**Applies to:** worktrees, branch bases, PR targets, and the orchestrator flow.

## The rule

> A **sprint** is a frame for concurrent work. It has no branch and no worktree.
> An **epic** is a feature. It owns a branch, and that is where its work merges.
> A **ticket** is a unit of work inside a feature. Its branch merges into its
> epic's branch.

Anything that affects a feature gets grouped into an epic, and the work lands on
that feature branch. Two levels of integration, not three:

```
ticket branch   tkxr/<ticket-id>        →  epic branch
epic branch     tkxr/epic/<epic-id>     →  main
sprint          (no branch)
```

A ticket with no epic is a standalone change and branches off `main` directly.
That is a signal, not an error: if it turns out to touch a feature, give it an
epic and it inherits the right base.

## Why

Sprints used to be one grouping among many, and a sprint branch was a reasonable
integration point. `tas-hr2pCGjr` changed what a sprint *is* — it now frames the
entire workspace. Every ticket on the board has one, so "the sprint branch" stopped
describing a unit of work and started describing "everything currently in flight."
Basing every branch in a workspace off one long-lived branch is a weak default;
that branch only accumulates and drifts.

An epic already maps one-to-one to a feature. That is exactly the shape of a
feature branch: it starts, it accumulates related commits, it merges, it ends.
The lifetime of the branch matches the lifetime of the thing it represents, which
is the property a sprint branch never had.

## What this reverses

`tas-IK2HcQWo` asked "does a sprint-level worktree still earn its keep now that a
sprint is the workspace?" and answered **yes, kept** — on the grounds that the
orchestrator flow merges ticket branches into the sprint branch, and that it was
the right base for epic-less tickets.

Both grounds are now answered differently:

- The orchestrator flow is not a reason to keep sprint branches; it is the thing
  that should not have been sprint-level. Fanning out sub-agents and merging
  their work is a *feature-level* activity: an epic has a goal and a bounded
  ticket set, a workspace has neither. Sprint-level orchestration is removed
  rather than re-pointed, because the epic equivalents already exist.
- Epic-less tickets branching off `main` is better than branching off a
  long-lived shared branch. It is the standard trunk-based answer and it removes
  a base that could drift arbitrarily far from `main`.

Recording the reversal rather than quietly rewriting the earlier decision: the
original answer was reasonable given sprint-as-workspace had only just landed,
and the cost of the change is bounded and known (below).

## The tradeoff being accepted

A sprint branch could act as a staging area where several epics integrated and
were tested together before reaching `main`. Dropping it means concurrent epics
discover their conflicts at `main` rather than at a shared branch one step
earlier.

This is accepted deliberately. A staging branch that outlives the work in it
drifts from `main` and turns into its own merge problem, and the conflicts it
surfaces early are the same ones `main` surfaces — just against a target nobody
ships. If cross-epic integration ever needs a rehearsal, the answer is a
short-lived branch created for that merge and deleted after, not a permanent one
attached to the workspace.

## What a sprint is for

Exactly one thing: **triage**. You look at everything in flight and sort it into
epics. That is the whole job — the sprint answers "what is being worked on right
now", and triage turns a loose pile into features.

Everything else that used to be sprint-level moves down to the epic:

| Was sprint-level | Now |
| --- | --- |
| Sprint worktree + branch | Epic worktree + branch |
| Orchestrate: fan out sub-agents, merge into the sprint branch | Orchestrate the epic, merge into the epic branch |
| Commit with Claude, in the sprint worktree | The epic worktree |
| Plan: turn a sprint goal into tickets | Plan the epic from its goal |
| Triage | **Stays** — and sorts the sprint's tickets into epics |

A sprint has no goal worth decomposing and no bounded ticket set; an epic has
both. Planning and orchestration were only ever sprint-level because the sprint
used to be a unit of work. It isn't one any more.

## Consequences

1. **Sprint-level orchestration is removed**, not re-pointed: the sprint
   orchestrator, sprint commit, and sprint planning prompts all go, along with
   their `SprintPanel` actions. The epic equivalents already exist.
2. **Sprint worktrees are removed** — the CLI `<spr-*>` forms, the
   `/api/sprints/:id/worktree` routes, `/api/sprints/:id/git`,
   `/api/sprints/:id/pr`, and `create_sprint_worktree` /
   `remove_sprint_worktree`.
3. **`resolveTicketBase` loses its middle rung.** It was epic → sprint → `HEAD`;
   it becomes epic → `HEAD`.
4. **`Sprint.worktree` stays in the type**, marked deprecated. Existing
   `sprints.json` records still carry it, and dropping the field would silently
   discard the path on the next write — leaving a worktree on disk that nothing
   remembers. It is read-only legacy: nothing writes it, `tkxr show` still
   prints it so an orphan is findable, and `git worktree remove` is how you
   clean one up.

## For agents

When you need somewhere to put work:

- Working a ticket? `create_worktree` — it picks the base for you and reports it
  as `basedOn`. If the ticket has an epic with a worktree you get the epic
  branch; otherwise `main`.
- Starting a feature? `create_epic_worktree`. That branch is what opens the PR.
- Orchestrating, planning or committing a batch of work? Do it on the epic.
  There is no sprint equivalent — `create_sprint_worktree` and the sprint
  orchestrate / commit / plan prompts no longer exist.
- Looking at a sprint? The only thing to do there is triage: sort its tickets
  into epics. If work does not fit an epic, the epic is missing.
