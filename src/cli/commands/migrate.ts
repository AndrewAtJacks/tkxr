import chalk from 'chalk';
import { createStorage, type MoveTicketsOptions } from '../../core/storage.js';
import { notifier } from '../../core/notifier.js';
import type { TicketStatus } from '../../core/types.js';

const STATUSES: TicketStatus[] = ['backlog', 'progress', 'review', 'blocked', 'done'];

/**
 * Shared implementation behind `tkxr sprint migrate` and `tkxr epic migrate`.
 *
 * Both commands are the same operation with a different source selector, and
 * the reporting (dry-run preview, per-status breakdown, "already there" count)
 * is where most of the code is — hence one function rather than two that drift.
 */
export interface MigrateInput {
  /** Target sprint id, or `none` for the Unsorted workspace. */
  target: string;
  fromSprint?: string;
  fromEpic?: string;
  /** Raw `--status` value: comma-separated, repeatable. */
  status?: string | string[];
  /** Raw `--tickets` value: comma-separated, repeatable. */
  tickets?: string | string[];
  dryRun?: boolean;
  /** `--keep-epic`: leave the epic itself where it is (epic scope only). */
  keepEpic?: boolean;
}

/** Split a repeatable comma-separated flag into trimmed, non-empty values. */
function listArg(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  const raw = Array.isArray(value) ? value : [value];
  return raw
    .flatMap(v => String(v).split(','))
    .map(v => v.trim())
    .filter(Boolean);
}

export async function runMigrate(input: MigrateInput): Promise<void> {
  const storage = await createStorage();

  const statuses = listArg(input.status);
  const invalid = statuses.filter(s => !STATUSES.includes(s as TicketStatus));
  if (invalid.length > 0) {
    console.error(chalk.red(`Invalid --status value(s): ${invalid.join(', ')}`));
    console.log(chalk.gray(`Valid statuses: ${STATUSES.join(', ')}`));
    process.exit(1);
  }

  const ticketIds = listArg(input.tickets);

  // `none` is the same sentinel the ticket filters use, so a selection can be
  // pasted straight from a `tkxr list --sprint none` into a migrate.
  const toSprint = input.target === 'none' ? null : input.target;

  if (toSprint !== null) {
    const sprints = await storage.getSprints();
    const target = sprints.find(s => s.id === toSprint);
    if (!target) {
      console.error(chalk.red(`Sprint "${toSprint}" not found.`));
      console.log(chalk.gray('Run "tkxr sprints" to see available sprints.'));
      process.exit(1);
    }
  }

  // Validate the source too — a typo'd source id otherwise reports a cheerful
  // "0 tickets moved" that reads like the sprint was already empty.
  if (input.fromSprint && input.fromSprint !== 'none') {
    const sprints = await storage.getSprints();
    if (!sprints.some(s => s.id === input.fromSprint)) {
      console.error(chalk.red(`Sprint "${input.fromSprint}" not found.`));
      process.exit(1);
    }
  }
  if (input.fromEpic && input.fromEpic !== 'none') {
    const epics = await storage.getEpics();
    if (!epics.some(e => e.id === input.fromEpic)) {
      console.error(chalk.red(`Epic "${input.fromEpic}" not found.`));
      process.exit(1);
    }
  }

  const options: MoveTicketsOptions = {
    toSprint,
    ...(input.fromSprint ? { fromSprint: input.fromSprint } : {}),
    ...(input.fromEpic ? { fromEpic: input.fromEpic } : {}),
    ...(statuses.length > 0 ? { statuses: statuses as TicketStatus[] } : {}),
    ...(ticketIds.length > 0 ? { ticketIds } : {}),
    ...(input.keepEpic ? { moveEpic: false } : {}),
    ...(input.dryRun ? { dryRun: true } : {}),
  };

  let result;
  try {
    result = await storage.moveTicketsToSprint(options);
  } catch (error) {
    console.error(chalk.red('Error migrating tickets:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
    return;
  }

  const targetLabel = toSprint === null
    ? 'Unsorted (no sprint)'
    : (await storage.getSprints()).find(s => s.id === toSprint)?.name || toSprint;

  if (result.matched === 0) {
    console.log(chalk.yellow('No tickets matched that selection — nothing to migrate.'));
    return;
  }

  if (input.dryRun) {
    console.log(chalk.blue.bold(`Dry run — ${result.moved.length} ticket(s) would move to ${targetLabel}`));
  } else {
    // Broadcast in one request rather than one per ticket: a whole-sprint
    // migration is easily hundreds of tickets.
    await notifier.notifyTicketsUpdated(result.moved);
    if (result.epic) await notifier.notifyEpicUpdated(result.epic);
    console.log(chalk.green.bold(`✓ Migrated ${result.moved.length} ticket(s) to ${targetLabel}`));
  }

  console.log();
  for (const t of result.moved.slice(0, 20)) {
    console.log(chalk.gray(`  ${t.id}  [${t.status}]  ${t.title}`));
  }
  if (result.moved.length > 20) {
    console.log(chalk.gray(`  …and ${result.moved.length - 20} more`));
  }
  if (result.alreadyThere > 0) {
    console.log();
    console.log(chalk.dim(`  ${result.alreadyThere} matched ticket(s) were already in ${targetLabel}.`));
  }
  if (result.epic) {
    console.log(chalk.dim(`  Epic ${result.epic.id} (${result.epic.name}) ${input.dryRun ? 'would move' : 'moved'} with them.`));
    console.log(chalk.dim('  Pass --keep-epic to leave the epic in its current sprint.'));
  }
  if (result.ungroupedTicketIds.length > 0) {
    const n = result.ungroupedTicketIds.length;
    console.log();
    console.log(chalk.yellow(`  ${n} ticket(s) ${input.dryRun ? 'would leave' : 'left'} their epic behind — it stays in the old sprint, so the tag ${input.dryRun ? 'would be' : 'was'} cleared:`));
    console.log(chalk.dim(`    ${result.ungroupedTicketIds.slice(0, 10).join(', ')}${n > 10 ? ', …' : ''}`));
    console.log(chalk.dim('  Re-file them in the target workspace with "tkxr epic set <ticket-id> <epic-id>",'));
    console.log(chalk.dim('  or move the whole epic with "tkxr epic migrate <epic-id> <sprint-id>".'));
  }
}
