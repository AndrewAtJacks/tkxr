import chalk from 'chalk';
import type minimist from 'minimist';
import { createStorage } from '../../core/storage.js';
import { notifier } from '../../core/notifier.js';

interface SprintArgs extends minimist.ParsedArgs {
  _: string[];
  name?: string;
  description?: string;
  goal?: string;
  'start-date'?: string;
  'end-date'?: string;
  'clear-description'?: boolean;
  'clear-goal'?: boolean;
  'clear-start-date'?: boolean;
  'clear-end-date'?: boolean;
  unset?: boolean;
}

export async function manageSprint(args: SprintArgs): Promise<void> {
  const [, subcommand, ...rest] = args._; // Skip the 'sprint' command itself

  if (!subcommand || subcommand === 'help') {
    showSprintHelp();
    return;
  }

  switch (subcommand) {
    case 'create':
      await createSprint(rest, args);
      break;
    case 'status':
      await updateSprintStatus(rest);
      break;
    case 'set':
      await setTicketSprint(rest, args);
      break;
    case 'edit':
      await editSprint(rest, args);
      break;
    default:
      console.error(chalk.red(`Unknown sprint command: ${subcommand}`));
      console.log(chalk.gray('Use "sprint help" for available commands.'));
      process.exit(1);
  }
}

function showSprintHelp() {
  console.log(chalk.blue.bold('Sprint Management Commands:'));
  console.log();
  console.log(chalk.green('Usage:'));
  console.log('  tkxr sprint <command> [options]');
  console.log();
  console.log(chalk.green('Commands:'));
  console.log('  create <name>                 Create a new sprint');
  console.log('  status <id> <status>          Update sprint status');
  console.log('  set <ticket-id> <sprint-id>   Attach a ticket to a sprint');
  console.log('  set <ticket-id> --unset       Remove a ticket from its sprint');
  console.log('  edit <id> [options]           Edit sprint fields (name/desc/goal/dates)');
  console.log();
  console.log(chalk.green('Options:'));
  console.log('  --description <text>       Sprint description (optional)');
  console.log('  --goal <text>             Sprint goal (optional)');
  console.log('  --start-date <date>       Start date (optional)');
  console.log('  --end-date <date>         End date (optional)');
  console.log('  --unset                   Remove ticket from its sprint');
  console.log();
  console.log(chalk.green('Status values:'));
  console.log('  planning, active, completed');
  console.log();
  console.log(chalk.green('Examples:'));
  console.log('  tkxr sprint create "Sprint 1"');
  console.log('  tkxr sprint create "Feature Sprint" --description "Add new features" --goal "Complete user auth"');
  console.log('  tkxr sprint status spr-abc123 active');
  console.log('  tkxr sprint set tas-abc123 spr-abc123');
  console.log('  tkxr sprint set tas-abc123 --unset');
  console.log('  tkxr sprint edit spr-abc123 --name "Renamed" --goal "Ship v2"');
  console.log('  tkxr sprint edit spr-abc123 --start-date 2026-07-10 --end-date 2026-07-24');
  console.log('  tkxr sprint edit spr-abc123 --clear-goal');
}

async function createSprint(rest: string[], args: SprintArgs): Promise<void> {
  const [name] = rest;
  
  if (!name) {
    console.error(chalk.red('Sprint name is required.'));
    console.log(chalk.gray('Usage: tkxr sprint create <name>'));
    process.exit(1);
  }

  try {
    const storage = await createStorage();
    const options: any = {};
    
    if (args.description) options.description = args.description;
    if (args.goal) options.goal = args.goal;
    if (args['start-date']) options.startDate = new Date(args['start-date']);
    if (args['end-date']) options.endDate = new Date(args['end-date']);

    const sprint = await storage.createSprint(name, options);

    console.log(chalk.green.bold('✓ Sprint created successfully!'));
    console.log();
    console.log(chalk.white.bold(sprint.name));
    console.log(chalk.gray(`  ID: ${sprint.id}`));
    console.log(chalk.gray(`  Status: `) + chalk.yellow(sprint.status));
    if (sprint.description) {
      console.log(chalk.gray(`  Description: ${sprint.description}`));
    }
    if (sprint.goal) {
      console.log(chalk.gray(`  Goal: ${sprint.goal}`));
    }
    console.log(chalk.gray(`  Created: ${new Date(sprint.createdAt).toLocaleDateString()}`));

  } catch (error) {
    console.error(chalk.red('Error creating sprint:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function updateSprintStatus(rest: string[]): Promise<void> {
  const [id, status] = rest;
  
  if (!id || !status) {
    console.error(chalk.red('Sprint ID and status are required.'));
    console.log(chalk.gray('Usage: tkxr sprint status <id> <status>'));
    process.exit(1);
  }

  if (!['planning', 'active', 'completed'].includes(status)) {
    console.error(chalk.red('Invalid status. Must be: planning, active, or completed'));
    process.exit(1);
  }

  try {
    const storage = await createStorage();
    
    const sprint = await storage.updateSprintStatus(id, status as any);

    if (!sprint) {
      console.error(chalk.red(`Sprint with ID "${id}" not found.`));
      process.exit(1);
    }

    await notifier.notifySprintUpdated(sprint);

    const statusColor =
      status === 'completed' ? 'green' :
      status === 'active' ? 'blue' : 'yellow';

    console.log(chalk.green.bold('✓ Sprint status updated!'));
    console.log();
    console.log(chalk.white.bold(sprint.name));
    console.log(chalk.gray(`  ID: ${sprint.id}`));
    console.log(chalk.gray(`  Status: `) + chalk[statusColor](sprint.status));

  } catch (error) {
    console.error(chalk.red('Error updating sprint status:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function setTicketSprint(rest: string[], args: SprintArgs): Promise<void> {
  const [ticketId, sprintId] = rest;

  if (!ticketId) {
    console.error(chalk.red('Ticket ID is required.'));
    console.log(chalk.gray('Usage: tkxr sprint set <ticket-id> <sprint-id>'));
    console.log(chalk.gray('       tkxr sprint set <ticket-id> --unset'));
    process.exit(1);
  }

  if (!sprintId && !args.unset) {
    console.error(chalk.red('Sprint ID or --unset is required.'));
    console.log(chalk.gray('Usage: tkxr sprint set <ticket-id> <sprint-id>'));
    process.exit(1);
  }

  try {
    const storage = await createStorage();

    const found = await storage.findTicket(ticketId);
    if (!found) {
      console.error(chalk.red(`Ticket "${ticketId}" not found.`));
      process.exit(1);
    }

    let assignedSprintId: string | undefined;
    let sprintLabel = '(none)';

    if (args.unset) {
      assignedSprintId = undefined;
    } else {
      const sprints = await storage.getSprints();
      const sprint = sprints.find(s => s.id === sprintId);
      if (!sprint) {
        console.error(chalk.red(`Sprint "${sprintId}" not found.`));
        console.log(chalk.gray('Run "tkxr sprints" to see available sprints.'));
        process.exit(1);
      }
      assignedSprintId = sprint.id;
      sprintLabel = `${sprint.name} (${sprint.status})`;
    }

    const updated = await storage.updateTicket(ticketId, { sprint: assignedSprintId });
    if (!updated) {
      console.error(chalk.red(`Failed to update ticket "${ticketId}".`));
      process.exit(1);
    }

    await notifier.notifyTicketUpdated(updated);

    console.log(chalk.green.bold(args.unset ? '✓ Ticket removed from sprint!' : '✓ Ticket added to sprint!'));
    console.log();
    console.log(chalk.white.bold(updated.title));
    console.log(chalk.gray(`  ID: ${updated.id}`));
    console.log(chalk.gray(`  Sprint: `) + chalk.magenta(sprintLabel));

  } catch (error) {
    console.error(chalk.red('Error setting ticket sprint:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function editSprint(rest: string[], args: SprintArgs): Promise<void> {
  const [id] = rest;

  if (!id) {
    console.error(chalk.red('Sprint ID is required.'));
    console.log(chalk.gray('Usage: tkxr sprint edit <id> [--name …] [--description …] [--goal …] [--start-date …] [--end-date …]'));
    process.exit(1);
  }

  const updates: any = {};

  if (args.name !== undefined) updates.name = args.name;

  if (args['clear-description']) updates.description = undefined;
  else if (args.description !== undefined) updates.description = args.description;

  if (args['clear-goal']) updates.goal = undefined;
  else if (args.goal !== undefined) updates.goal = args.goal;

  if (args['clear-start-date']) updates.startDate = undefined;
  else if (args['start-date']) {
    const d = new Date(args['start-date']);
    if (Number.isNaN(d.getTime())) {
      console.error(chalk.red('Invalid --start-date'));
      process.exit(1);
    }
    updates.startDate = d;
  }

  if (args['clear-end-date']) updates.endDate = undefined;
  else if (args['end-date']) {
    const d = new Date(args['end-date']);
    if (Number.isNaN(d.getTime())) {
      console.error(chalk.red('Invalid --end-date'));
      process.exit(1);
    }
    updates.endDate = d;
  }

  if (Object.keys(updates).length === 0) {
    console.log(chalk.yellow('No changes specified. See "sprint help" for options.'));
    return;
  }

  try {
    const storage = await createStorage();
    const sprint = await storage.updateSprint(id, updates);
    if (!sprint) {
      console.error(chalk.red(`Sprint "${id}" not found.`));
      process.exit(1);
    }

    await notifier.notifySprintUpdated(sprint);

    console.log(chalk.green.bold('✓ Sprint updated!'));
    console.log();
    console.log(chalk.white.bold(sprint.name));
    console.log(chalk.gray(`  ID: ${sprint.id}`));
    console.log(chalk.gray(`  Status: `) + chalk.yellow(sprint.status));
    if (sprint.description) console.log(chalk.gray(`  Description: ${sprint.description}`));
    if (sprint.goal) console.log(chalk.gray(`  Goal: ${sprint.goal}`));
    if (sprint.startDate) console.log(chalk.gray(`  Start: ${new Date(sprint.startDate).toLocaleDateString()}`));
    if (sprint.endDate) console.log(chalk.gray(`  End: ${new Date(sprint.endDate).toLocaleDateString()}`));

  } catch (error) {
    console.error(chalk.red('Error updating sprint:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}