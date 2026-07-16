# Research: Alternatives to Git Worktrees for Concurrent Agent Isolation

**Ticket:** `tas-Ap8VMPuL`
**Sprint:** `spr-C5Rl8Kim` (Implement Claude CLI)
**Status:** Research — no code changes.

## Context

Today `tkxr` isolates concurrent agent work with `git worktree`. `create_worktree` /
`create_sprint_worktree` in `src/core/worktree.ts` shell out to `git worktree add`,
picking a per-ticket path (`<repo-parent>/<repo>-worktrees/<ticketId>`) and a per-ticket
branch (`tkxr/<ticketId>`), with sprint-level orchestration in `orchestrateSprintPrompt`
(`src/web/src/lib/prompts.ts`). The sprint orchestrator agent owns the sprint worktree
and fans out sub-agents; each sub-agent gets its own worktree + branch and merges back
into the sprint branch.

The complaint from the ticket is that worktrees are "heavyweight" — full checkout per
ticket, disk cost, git plumbing, and cleanup edge cases (stale entries, force-remove on
uncommitted changes, branch deletion best-effort). Since Windows is a first-class
target (this repo runs on Windows 10, `D:\Code\tkxr`), any replacement must be
Windows-native. The claude CLI flow doesn't fundamentally change the requirement — we
still need each parallel sub-agent to have a self-consistent view of the repo where it
can edit, run tests, and commit without racing peers.

## Evaluation dimensions

Each option is scored 1–5 (5 = best) on:

- **Setup cost** — code + operational work to introduce; steady-state per-agent cost.
- **Isolation** — how well one agent's edits, staging, and running processes are hidden
  from peers.
- **Cross-platform (Windows-critical)** — does it work on Windows 10/11 without WSL, on
  macOS, and on Linux? Windows failure = 1 regardless of Unix score.
- **Cleanup** — how easy is it to reap after a crash / abandoned session.
- **Resource cost** — disk, RAM, CPU, IO per concurrent agent.

Higher composite = better fit for tkxr's current flow.

---

## 1. Git worktrees (current baseline)

Full separate checkout per ticket, sharing the `.git` object store via a lightweight
`.git` file pointing back to the primary repo.

- **Setup cost: 4** — already implemented in `src/core/worktree.ts`. `git worktree add`
  is one command; branch reuse is already handled by `checkBranchExists`.
- **Isolation: 5** — separate cwd, separate index, separate `HEAD`. Two agents can be
  mid-edit on completely different files or the same file without seeing each other.
  Perfect for parallel `claude` CLI invocations.
- **Cross-platform: 5** — `git worktree` is core git since 2.5 (2015). Works identically
  on Windows, macOS, Linux. No admin/root, no filesystem prerequisites.
- **Cleanup: 3** — `git worktree remove` + `git worktree prune` covers most cases, but
  edge cases exist: uncommitted changes need `--force`, deleted-out-of-band paths need
  prune, branch deletion is best-effort in the current code. The existing MCP surface
  handles this reasonably.
- **Resource cost: 2** — full working-tree copy per ticket. On this repo that's ~200 MB
  including `node_modules` if the user copies them, though the shared `.git` object
  store keeps history from being duplicated. Real cost is the working tree files
  themselves plus any language toolchain caches inside them.

**Composite: 19/25.** Solid across the board; the only weak axis is disk.

---

## 2. Lightweight filesystem snapshots (btrfs / ZFS / APFS clones)

Create a copy-on-write snapshot of the repo directory per agent. On btrfs:
`btrfs subvolume snapshot`. On ZFS: `zfs clone`. On APFS: `cp -c` (clonefile). On
Windows NTFS: no equivalent — Dev Drive (ReFS) has block-cloning but only via
`CopyFileEx(COPY_FILE_REQUEST_COMPRESSED_TRAFFIC)` or `FSCTL_DUPLICATE_EXTENTS_TO_FILE`,
which requires ReFS-on-Windows-Server or the newer Dev Drive feature on Windows 11.

- **Setup cost: 2** — need a snapshot abstraction, per-OS branches, and a policy for
  where snapshots live. Also need to teach git to treat snapshots as independent (either
  reinit `.git` or run inside the snapshot without extra effort).
- **Isolation: 4** — the FS gives you a private mutable copy. But git-state isolation
  still requires that snapshots have their own `.git`, otherwise concurrent index
  writes collide. Snapshots-of-`.git` work but are subtle.
- **Cross-platform: 1** — Windows 10 has no viable equivalent for the average user.
  ReFS/Dev Drive is opt-in and not on `C:`. This alone disqualifies for our
  Windows-critical constraint.
- **Cleanup: 5** — snapshot delete is O(1) on all three FSes. This is the killer
  advantage on Unix.
- **Resource cost: 5** — CoW means the disk cost is only the diff. Excellent.

**Composite: 17/25**, but Windows-blocked; **do not adopt as sole strategy.**

---

## 3. Containers / Docker per agent

Spawn one Docker container per agent, mounting the repo (or a copy) as a volume, and
run the `claude` CLI inside.

- **Setup cost: 1** — requires Docker/Podman as a hard dep, image maintenance, volume
  strategy, network config, and a wrapper that binds a claude CLI session and MCP into
  a container. Big lift.
- **Isolation: 5** — process, filesystem, network, PID namespaces. Strongest isolation
  of any option; kills a bad agent by killing the container.
- **Cross-platform: 3** — Docker Desktop on Windows works but is heavy (WSL2 backing,
  license considerations for orgs) and slow for IO into bind mounts. Podman Desktop
  similar. macOS also uses a Linux VM. Not a great fit for a CLI that expects to feel
  like a local checkout.
- **Cleanup: 4** — `docker rm -f` reaps everything, but dangling volumes/images are a
  real thing and require pruning discipline.
- **Resource cost: 2** — the Linux VM overhead on Windows/macOS plus per-container RAM
  makes this the heaviest option per agent.

**Composite: 15/25.** Great isolation, but the sledgehammer for our nail. Reserve for
security-sensitive flows (e.g. running untrusted code).

---

## 4. Overlay filesystems / OverlayFS

Mount a per-agent upper layer over a shared read-only lower (the base checkout). Each
agent sees the same base but writes only to its own upper. Native to Linux
(`overlayfs`). FUSE ports exist for macOS (`unionfs-fuse`); on Windows there's Projected
File System (ProjFS, used by Scalar/VFS-for-Git) but no general-purpose overlay mount.

- **Setup cost: 2** — root/admin required to mount on Linux, external tools elsewhere.
  Also need to reason about git's behavior when `.git` is layered (unpredictable — git
  writes lockfiles and expects atomic renames).
- **Isolation: 3** — per-agent writable layer works, but overlayfs semantics around
  whiteouts + renames + git's index writes are a known footgun.
- **Cross-platform: 1** — Windows has no user-friendly overlay mount. ProjFS is a
  driver, not a mount API for user code without significant integration work.
- **Cleanup: 4** — `umount` + `rm -rf upperdir` is quick.
- **Resource cost: 5** — same CoW win as snapshots.

**Composite: 15/25.** Same Windows blocker; also brittle around git internals.

---

## 5. Copy-on-write directory copies (`cp --reflink`, `robocopy`)

Do a fast per-ticket copy of the repo. On Linux with a reflink-capable FS
(btrfs/xfs/bcachefs): `cp --reflink=auto`. On macOS APFS: `cp -c`. On Windows: nothing
truly CoW on NTFS; the closest is `robocopy /MIR` or PowerShell `Copy-Item`, which is a
plain byte-copy.

- **Setup cost: 4** — trivial to script per-OS. But the wrapper needs to know which
  filesystem it's on.
- **Isolation: 4** — fully independent trees, including `.git`. Great for git-writing
  agents.
- **Cross-platform: 2** — works everywhere, but on Windows/NTFS you pay full duplicate
  cost every time (full copy of `.git` history included, which for a repo with a big
  pack file is bad). Reflink Linux/APFS is fast + cheap; NTFS full copy is neither.
- **Cleanup: 5** — `rm -rf` / `Remove-Item -Recurse`. Simple.
- **Resource cost: 3** — CoW where supported (5), full copy on Windows (1). Averaged.

**Composite: 18/25.** Practical, but on Windows it's strictly worse than `git worktree`
(worktree shares the object store; a plain copy of the checkout re-duplicates `.git`).
Only wins on Unix with reflinks, and not by much versus worktree.

---

## 6. Session-per-branch checkouts (single checkout, swap branches between agents)

One working tree; each agent gets a shell/CLI session and switches to its target branch
when it's that agent's turn. Effectively serial with per-agent context via
`git switch` + `git stash`.

- **Setup cost: 5** — no infra beyond a mutex around `git switch`. Cheapest to build.
- **Isolation: 1** — this is the whole problem. Two concurrent agents mean two writers
  to the same working tree and index. `git stash push` between switches is fragile with
  untracked files, submodules, or half-run test artifacts. Race conditions guaranteed
  under any real parallelism. This defeats the fan-out flow in
  `orchestrateSprintPrompt` which explicitly counts on parallel non-colliding editors.
- **Cross-platform: 5** — pure git; nothing else needed.
- **Cleanup: 5** — nothing to clean; one tree.
- **Resource cost: 5** — one checkout, period.

**Composite: 21/25 on paper, but the Isolation=1 is a hard veto** for tkxr's fan-out
model. Only viable if we drop parallelism entirely and serialize sub-agents, which
undoes the point of the sprint orchestrator.

---

## Score summary

| Option                        | Setup | Isolation | Windows | Cleanup | Resource | Total |
|-------------------------------|-------|-----------|---------|---------|----------|-------|
| Git worktrees (current)       | 4     | 5         | 5       | 3       | 2        | **19** |
| FS snapshots (btrfs/ZFS/APFS) | 2     | 4         | 1       | 5       | 5        | 17    |
| Containers / Docker           | 1     | 5         | 3       | 4       | 2        | 15    |
| OverlayFS                     | 2     | 3         | 1       | 4       | 5        | 15    |
| CoW dir copies                | 4     | 4         | 2       | 5       | 3        | 18    |
| Session-per-branch (serial)   | 5     | 1         | 5       | 5       | 5        | 21*   |

\* Session-per-branch tops the raw sum but fails the parallelism invariant tkxr
depends on; it's disqualified in practice.

## Recommendation: **KEEP git worktrees** (with a small hybrid escape hatch)

**Keep worktrees as the default and only production isolation strategy.** They are the
only option that:

1. Works out of the box on Windows, macOS, and Linux with zero extra deps.
2. Fully isolates concurrent editors *and* concurrent git-index writers.
3. Is already implemented, tested, and integrated with the MCP surface + orchestrator
   flow.
4. Shares the object store, so the "heavyweight" claim is largely about the working
   tree files, not git history.

The alternatives either fail Windows (snapshots, overlayfs), add heavy new deps
(containers), duplicate more state than worktrees on Windows (plain copies), or break
the fan-out parallelism model (session-per-branch).

### Where the current implementation can improve (without switching strategy)

These are cheap, targeted fixes to soften worktree pain points, addressable in a
follow-up sprint:

1. **Better cleanup on abandoned sessions.** Add `tkxr worktree gc` that walks
   `git worktree list --porcelain`, cross-references `ticket.worktree` in storage, and
   offers to remove orphans (worktree exists but ticket is `done` and merged, or ticket
   is deleted). Today cleanup is manual per-ticket.
2. **`.gitignore`-aware disk cost.** Emit a warning at `create_worktree` time if the
   parent tree contains a large uncommitted directory (`node_modules`, `dist`, build
   caches) that would balloon the checkout. Suggest the user commit or `.gitignore`.
3. **Reuse `node_modules` via symlink or junction (opt-in).** On both Windows
   (`mklink /J`) and Unix (symlink), post-create hook can point `node_modules` at the
   sprint worktree's copy. Reduces the "heavy" feeling without touching git.
4. **Sparse checkout for very large monorepos.** `git sparse-checkout set` after
   `worktree add` restricts the checkout to a subtree; opt-in via
   `create_worktree({ ..., sparse: ["src/", "package.json"] })`. Cross-platform, git
   native, minimal MCP change.
5. **Configurable base and cleanup policy** already largely in place — document the
   `TKXR_WORKTREE_ROOT` env var + auto-cleanup on `update_ticket_status → done` more
   prominently.

### Small hybrid escape hatch (optional)

For sensitive or destructive flows (e.g. an agent running untrusted `npm install`
scripts), allow an opt-in container-per-agent mode:

```
create_worktree({ ticketId, isolation: "container", image: "node:20" })
```

The MCP tool would still create the worktree on disk (so the human can inspect it),
then run subsequent agent commands via `docker run --rm -v <worktree>:/work -w /work
<image>`. Off by default; keeps the door open without forcing containers on Windows
users who don't want Docker Desktop.

### MCP surface change if adopted

Minimal. `create_worktree` and `create_sprint_worktree` both gain optional
`sparse?: string[]` and (later) `isolation?: "worktree" | "container"` fields.
No breaking change to existing consumers.

## Not-recommended paths

- **Do not adopt snapshots or overlayfs.** They fail Windows.
- **Do not replace worktrees with plain copies.** On NTFS they are strictly worse than
  worktrees.
- **Do not adopt session-per-branch.** Breaks the fan-out model.
- **Do not require containers.** Overkill for the default flow; keep as opt-in.

## TL;DR

Git worktrees are the right primitive for this workload. The pain the ticket describes
(disk cost, cleanup) is best addressed with small QoL improvements on top of the
existing implementation, not by swapping the primitive. Score-wise nothing else beats
worktrees on the axes that matter for a cross-platform, parallel, git-native
orchestrator.
