import chalk from 'chalk';
import type minimist from 'minimist';
import { createStorage } from '../../core/storage.js';
import type { Epic, Sprint } from '../../core/types.js';

interface EpicsArgs extends minimist.ParsedArgs {
  _: string[];
  status?: 'planning' | 'active' | 'completed';
  /** Sprint (workspace) id, or the literal `none` for sprintless epics. */
  sprint?: string;
}

export async function listEpics(args: EpicsArgs): Promise<void> {
  try {
    const storage = await createStorage();
    let epics = await storage.getEpics();

    if (args.status) {
      epics = epics.filter(epic => epic.status === args.status);
    }

    // `--sprint none` mirrors the board's Unsorted workspace: epics that aren't
    // attached to any sprint (e.g. orphaned by a sprint delete).
    if (args.sprint) {
      epics = args.sprint === 'none'
        ? epics.filter(epic => !epic.sprint)
        : epics.filter(epic => epic.sprint === args.sprint);
    }

    if (epics.length === 0) {
      const filters = [
        args.status ? `status "${args.status}"` : null,
        args.sprint ? `sprint "${args.sprint}"` : null,
      ].filter(Boolean);
      const filterText = filters.length ? ` matching ${filters.join(' and ')}` : '';
      console.log(chalk.yellow(`No epics found${filterText}.`));
      return;
    }

    const sprints = await storage.getSprints();
    const sprintName = (id: string | undefined) =>
      id ? (sprints.find((s: Sprint) => s.id === id)?.name || id) : undefined;

    // Ticket counts per epic — cheap enough here since the CLI reads the whole
    // set anyway, and it's the number that makes an epic listing useful.
    const tickets = await storage.getAllTickets();
    const counts = new Map<string, { total: number; done: number }>();
    for (const ticket of tickets) {
      if (!ticket.epic) continue;
      const bucket = counts.get(ticket.epic) || { total: 0, done: 0 };
      bucket.total++;
      if (ticket.status === 'done') bucket.done++;
      counts.set(ticket.epic, bucket);
    }

    console.log(chalk.blue.bold(`Found ${epics.length} epic${epics.length === 1 ? '' : 's'}:`));
    console.log();

    for (const epic of epics as Epic[]) {
      const statusColor =
        epic.status === 'completed' ? 'green' :
        epic.status === 'active' ? 'blue' : 'yellow';
      const count = counts.get(epic.id) || { total: 0, done: 0 };

      console.log(chalk.white.bold(epic.name));
      console.log(chalk.gray(`  ID: ${epic.id}`));
      console.log(chalk.gray(`  Status: `) + chalk[statusColor](epic.status));
      console.log(chalk.gray(`  Sprint: `) + (epic.sprint ? chalk.magenta(sprintName(epic.sprint)!) : chalk.dim('none')));
      console.log(chalk.gray(`  Tickets: ${count.done}/${count.total} done`));
      if (epic.description) console.log(chalk.gray(`  Description: ${epic.description}`));
      if (epic.goal) console.log(chalk.gray(`  Goal: ${epic.goal}`));
      if (epic.color) console.log(chalk.gray(`  Color: ${epic.color}`));
      console.log(chalk.gray(`  Created: ${new Date(epic.createdAt).toLocaleDateString()}`));
      console.log();
    }
  } catch (error) {
    console.error(chalk.red('Error listing epics:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
