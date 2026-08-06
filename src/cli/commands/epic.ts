import chalk from 'chalk';
import type minimist from 'minimist';
import { createStorage } from '../../core/storage.js';
import { notifier } from '../../core/notifier.js';
import { COLOR_ERROR, isValidColor } from '../../core/color.js';
import { runMigrate } from './migrate.js';
import type { Epic, EpicStatus, Sprint } from '../../core/types.js';

interface EpicArgs extends minimist.ParsedArgs {
  _: string[];
  name?: string;
  description?: string;
  goal?: string;
  color?: string;
  sprint?: string;
  'clear-description'?: boolean;
  'clear-goal'?: boolean;
  'clear-color'?: boolean;
  'clear-sprint'?: boolean;
  unset?: boolean;
  status?: string | string[];
  tickets?: string | string[];
  'dry-run'?: boolean;
  'keep-epic'?: boolean;
}

const VALID_EPIC_STATUSES: EpicStatus[] = ['planning', 'active', 'completed'];

export async function manageEpic(args: EpicArgs): Promise<void> {
  const [, subcommand, ...rest] = args._; // Skip the 'epic' command itself

  if (!subcommand || subcommand === 'help') {
    showEpicHelp();
    return;
  }

  switch (subcommand) {
    case 'create':
      await createEpic(rest, args);
      break;
    case 'status':
      await updateEpicStatus(rest);
      break;
    case 'set':
      await setTicketEpic(rest, args);
      break;
    case 'edit':
      await editEpic(rest, args);
      break;
    case 'migrate':
      await migrateEpic(rest, args);
      break;
    default:
      console.error(chalk.red(`Unknown epic command: ${subcommand}`));
      console.log(chalk.gray('Use "epic help" for available commands.'));
      process.exit(1);
  }
}

function showEpicHelp() {
  console.log(chalk.blue.bold('Epic Management Commands:'));
  console.log();
  console.log(chalk.gray('An epic groups tickets *within* a sprint. The sprint is the workspace'));
  console.log(chalk.gray('frame; epics slice the tickets inside it into features/initiatives.'));
  console.log();
  console.log(chalk.green('Usage:'));
  console.log('  tkxr epic <command> [options]');
  console.log();
  console.log(chalk.green('Commands:'));
  console.log('  create <name>                 Create a new epic');
  console.log('  status <id> <status>          Update epic status');
  console.log('  set <ticket-id> <epic-id>     Attach a ticket to an epic');
  console.log('  set <ticket-id> --unset       Remove a ticket from its epic');
  console.log('  edit <id> [options]           Edit epic fields (name/desc/goal/color/sprint)');
  console.log('  migrate <id> <sprint-id>      Move the epic and its tickets to another sprint');
  console.log();
  console.log(chalk.green('Options:'));
  console.log('  --description <text>      Epic description (optional)');
  console.log('  --goal <text>             Epic goal (optional)');
  console.log('  --color <hex>             Chip color used by the board (optional)');
  console.log('  --sprint <id>             Sprint (workspace) the epic lives under');
  console.log('  --unset                   Remove ticket from its epic');
  console.log();
  console.log(chalk.green('Migrate options:'));
  console.log('  --status <list>           Only these statuses (comma-separated, repeatable)');
  console.log('  --keep-epic               Move the tickets but leave the epic where it is');
  console.log('  --dry-run                 Show what would move without writing');
  console.log(chalk.dim('  The target may be "none" for the Unsorted (no sprint) bucket.'));
  console.log(chalk.dim('  A --status subset moves only those tickets; the epic stays put.'));
  console.log(chalk.dim('  Tickets that move away from an epic that stays behind lose the epic tag —'));
  console.log(chalk.dim('  an epic belongs to one workspace.'));
  console.log();
  console.log(chalk.green('Status values:'));
  console.log('  planning, active, completed');
  console.log();
  console.log(chalk.green('Examples:'));
  console.log('  tkxr epic create "Auth" --sprint spr-abc12345 --goal "Ship SSO"');
  console.log('  tkxr epic status epi-abc12345 completed');
  console.log('  tkxr epic set tas-abc12345 epi-abc12345');
  console.log('  tkxr epic set tas-abc12345 --unset');
  console.log('  tkxr epic edit epi-abc12345 --name "Auth & SSO" --color "#7c3aed"');
  console.log('  tkxr epic edit epi-abc12345 --clear-sprint');
  console.log('  tkxr epics --sprint spr-abc12345');
  console.log('  tkxr epic migrate epi-abc12345 spr-def45678');
  console.log('  tkxr epic migrate epi-abc12345 spr-def45678 --status backlog --keep-epic');
}

/**
 * Move an epic's tickets into another workspace (tas-vEpBfx0t).
 *
 * `epic edit --sprint` moves only the epic record, which leaves its tickets
 * behind in the old workspace — an epic rendering under a sprint that holds
 * none of its work. This moves both, unless `--keep-epic` or a `--status`
 * subset says otherwise (a partial move is a split, not a move, so the epic
 * stays with the tickets left behind).
 */
async function migrateEpic(rest: string[], args: EpicArgs): Promise<void> {
  const [epicId, target] = rest;

  if (!epicId || !target) {
    console.error(chalk.red('Epic ID and target sprint ID are required.'));
    console.log(chalk.gray('Usage: tkxr epic migrate <epic-id> <sprint-id> [--status ...] [--keep-epic] [--dry-run]'));
    console.log(chalk.gray('       The target may be "none" for the Unsorted bucket.'));
    process.exit(1);
  }

  await runMigrate({
    target,
    fromEpic: epicId,
    status: args.status,
    tickets: args.tickets,
    keepEpic: !!args['keep-epic'],
    dryRun: !!args['dry-run'],
  });
}

/** Print the standard epic summary block used by create/status/edit. */
function printEpic(epic: Epic, sprints: Sprint[]): void {
  const statusColor =
    epic.status === 'completed' ? 'green' :
    epic.status === 'active' ? 'blue' : 'yellow';
  const sprintLabel = epic.sprint
    ? (sprints.find(s => s.id === epic.sprint)?.name || epic.sprint)
    : undefined;

  console.log(chalk.white.bold(epic.name));
  console.log(chalk.gray(`  ID: ${epic.id}`));
  console.log(chalk.gray(`  Status: `) + chalk[statusColor](epic.status));
  console.log(chalk.gray(`  Sprint: `) + (sprintLabel ? chalk.magenta(sprintLabel) : chalk.dim('none')));
  if (epic.description) console.log(chalk.gray(`  Description: ${epic.description}`));
  if (epic.goal) console.log(chalk.gray(`  Goal: ${epic.goal}`));
  if (epic.color) console.log(chalk.gray(`  Color: ${epic.color}`));
}

async function createEpic(rest: string[], args: EpicArgs): Promise<void> {
  const [name] = rest;

  if (!name) {
    console.error(chalk.red('Epic name is required.'));
    console.log(chalk.gray('Usage: tkxr epic create <name> [--sprint <id>]'));
    process.exit(1);
  }

  try {
    const storage = await createStorage();
    const sprints = await storage.getSprints();
    const options: Partial<Epic> = {};

    if (args.description) options.description = args.description;
    if (args.goal) options.goal = args.goal;
    if (args.color) {
      if (!isValidColor(args.color)) {
        console.error(chalk.red(COLOR_ERROR));
        process.exit(1);
      }
      options.color = args.color;
    }
    if (args.sprint) {
      const sprint = sprints.find((s: Sprint) => s.id === args.sprint);
      if (!sprint) {
        console.error(chalk.red(`Sprint "${args.sprint}" not found.`));
        console.log(chalk.gray('Run "tkxr sprints" to see available sprints.'));
        process.exit(1);
      }
      options.sprint = sprint.id;
    }

    const epic = await storage.createEpic(name, options);

    await notifier.notifyEpicCreated(epic);

    console.log(chalk.green.bold('✓ Epic created successfully!'));
    console.log();
    printEpic(epic, sprints);
    console.log(chalk.gray(`  Created: ${new Date(epic.createdAt).toLocaleDateString()}`));
    if (!epic.sprint) {
      console.log();
      console.log(chalk.dim('Note: this epic has no sprint, so it only shows in the Unsorted workspace.'));
      console.log(chalk.dim('Attach it with: tkxr epic edit ' + epic.id + ' --sprint <sprint-id>'));
    }
  } catch (error) {
    console.error(chalk.red('Error creating epic:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function updateEpicStatus(rest: string[]): Promise<void> {
  const [id, status] = rest;

  if (!id || !status) {
    console.error(chalk.red('Epic ID and status are required.'));
    console.log(chalk.gray('Usage: tkxr epic status <id> <status>'));
    process.exit(1);
  }

  if (!VALID_EPIC_STATUSES.includes(status as EpicStatus)) {
    console.error(chalk.red(`Invalid status. Must be: ${VALID_EPIC_STATUSES.join(', ')}`));
    process.exit(1);
  }

  try {
    const storage = await createStorage();
    const epic = await storage.updateEpic(id, { status: status as EpicStatus });

    if (!epic) {
      console.error(chalk.red(`Epic with ID "${id}" not found.`));
      process.exit(1);
    }

    await notifier.notifyEpicUpdated(epic);

    console.log(chalk.green.bold('✓ Epic status updated!'));
    console.log();
    printEpic(epic, await storage.getSprints());
  } catch (error) {
    console.error(chalk.red('Error updating epic status:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function setTicketEpic(rest: string[], args: EpicArgs): Promise<void> {
  const [ticketId, epicId] = rest;

  if (!ticketId) {
    console.error(chalk.red('Ticket ID is required.'));
    console.log(chalk.gray('Usage: tkxr epic set <ticket-id> <epic-id>'));
    console.log(chalk.gray('       tkxr epic set <ticket-id> --unset'));
    process.exit(1);
  }

  if (!epicId && !args.unset) {
    console.error(chalk.red('Epic ID or --unset is required.'));
    console.log(chalk.gray('Usage: tkxr epic set <ticket-id> <epic-id>'));
    process.exit(1);
  }

  try {
    const storage = await createStorage();

    const found = await storage.findTicket(ticketId);
    if (!found) {
      console.error(chalk.red(`Ticket "${ticketId}" not found.`));
      process.exit(1);
    }

    let assignedEpicId: string | undefined;
    let epicLabel = '(none)';
    let epic: Epic | undefined;

    if (!args.unset) {
      const epics = await storage.getEpics();
      epic = epics.find((e: Epic) => e.id === epicId);
      if (!epic) {
        console.error(chalk.red(`Epic "${epicId}" not found.`));
        console.log(chalk.gray('Run "tkxr epics" to see available epics.'));
        process.exit(1);
      }
      assignedEpicId = epic!.id;
      epicLabel = `${epic!.name} (${epic!.status})`;
    }

    const updated = await storage.updateTicket(ticketId, { epic: assignedEpicId });
    if (!updated) {
      console.error(chalk.red(`Failed to update ticket "${ticketId}".`));
      process.exit(1);
    }

    await notifier.notifyTicketUpdated(updated);

    console.log(chalk.green.bold(args.unset ? '✓ Ticket removed from epic!' : '✓ Ticket added to epic!'));
    console.log();
    console.log(chalk.white.bold(updated.title));
    console.log(chalk.gray(`  ID: ${updated.id}`));
    console.log(chalk.gray(`  Epic: `) + chalk.magenta(epicLabel));

    // The board scopes to a sprint, so a ticket filed under an epic in another
    // workspace would silently vanish from view. Warn instead of retargeting.
    if (epic && epic.sprint && updated.sprint !== epic.sprint) {
      console.log();
      console.log(chalk.yellow(`Warning: ticket sprint (${updated.sprint || 'none'}) differs from the epic's sprint (${epic.sprint}).`));
      console.log(chalk.dim(`Move it with: tkxr sprint set ${updated.id} ${epic.sprint}`));
    }
  } catch (error) {
    console.error(chalk.red('Error setting ticket epic:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function editEpic(rest: string[], args: EpicArgs): Promise<void> {
  const [id] = rest;

  if (!id) {
    console.error(chalk.red('Epic ID is required.'));
    console.log(chalk.gray('Usage: tkxr epic edit <id> [--name …] [--description …] [--goal …] [--color …] [--sprint …]'));
    process.exit(1);
  }

  const updates: Partial<Pick<Epic, 'name' | 'description' | 'goal' | 'color' | 'sprint'>> = {};

  if (args.name !== undefined) updates.name = String(args.name);

  if (args['clear-description']) updates.description = undefined;
  else if (args.description !== undefined) updates.description = String(args.description);

  if (args['clear-goal']) updates.goal = undefined;
  else if (args.goal !== undefined) updates.goal = String(args.goal);

  if (args['clear-color']) updates.color = undefined;
  else if (args.color !== undefined) {
    if (!isValidColor(String(args.color))) {
      console.error(chalk.red(COLOR_ERROR));
      process.exit(1);
    }
    updates.color = String(args.color);
  }

  if (args['clear-sprint']) updates.sprint = undefined;
  else if (args.sprint !== undefined) updates.sprint = String(args.sprint);

  if (Object.keys(updates).length === 0) {
    console.log(chalk.yellow('No changes specified. See "epic help" for options.'));
    return;
  }

  try {
    const storage = await createStorage();
    const sprints = await storage.getSprints();

    // Validate the target workspace up front — a dangling sprint ref would hide
    // the epic from every board view without any error surfacing.
    if (updates.sprint !== undefined && !args['clear-sprint']) {
      if (!sprints.some((s: Sprint) => s.id === updates.sprint)) {
        console.error(chalk.red(`Sprint "${updates.sprint}" not found.`));
        console.log(chalk.gray('Run "tkxr sprints" to see available sprints.'));
        process.exit(1);
      }
    }

    const epic = await storage.updateEpic(id, updates);
    if (!epic) {
      console.error(chalk.red(`Epic "${id}" not found.`));
      process.exit(1);
    }

    await notifier.notifyEpicUpdated(epic);

    console.log(chalk.green.bold('✓ Epic updated!'));
    console.log();
    printEpic(epic, sprints);
  } catch (error) {
    console.error(chalk.red('Error updating epic:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
