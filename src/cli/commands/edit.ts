import chalk from 'chalk';
import type minimist from 'minimist';
import { createStorage } from '../../core/storage.js';
import { notifier } from '../../core/notifier.js';
import type { Ticket } from '../../core/types.js';

interface EditArgs extends minimist.ParsedArgs {
  _: string[];
  title?: string;
  description?: string;
  priority?: string;
  estimate?: string | number;
  'add-label'?: string | string[];
  'remove-label'?: string | string[];
  'clear-labels'?: boolean;
  'clear-priority'?: boolean;
  'clear-estimate'?: boolean;
  'clear-description'?: boolean;
}

const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'];

function toArray(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

export async function editTicket(args: EditArgs): Promise<void> {
  const [, id] = args._;

  if (!id) {
    console.log(chalk.red('Error: Ticket ID is required'));
    console.log(chalk.gray('Usage: tkxr edit <ticket-id> [--title …] [--description …] [--priority …] [--estimate N] [--add-label L] [--remove-label L] [--clear-labels] [--clear-priority] [--clear-estimate] [--clear-description]'));
    process.exit(1);
  }

  const storage = await createStorage();
  const found = await storage.findTicket(id);
  if (!found) {
    console.log(chalk.red(`Ticket "${id}" not found.`));
    process.exit(1);
  }

  const current = found.ticket;
  const updates: Partial<Ticket> = {};

  if (args.title !== undefined) updates.title = String(args.title);

  if (args['clear-description']) {
    updates.description = undefined;
  } else if (args.description !== undefined) {
    updates.description = String(args.description);
  }

  if (args['clear-priority']) {
    updates.priority = undefined;
  } else if (args.priority !== undefined) {
    if (!VALID_PRIORITIES.includes(String(args.priority))) {
      console.log(chalk.red(`Error: Invalid priority. Must be one of: ${VALID_PRIORITIES.join(', ')}`));
      process.exit(1);
    }
    updates.priority = args.priority as Ticket['priority'];
  }

  if (args['clear-estimate']) {
    updates.estimate = undefined;
  } else if (args.estimate !== undefined) {
    const n = typeof args.estimate === 'number' ? args.estimate : parseInt(String(args.estimate), 10);
    if (Number.isNaN(n)) {
      console.log(chalk.red('Error: --estimate must be a number'));
      process.exit(1);
    }
    updates.estimate = n;
  }

  const addLabels = toArray(args['add-label']);
  const removeLabels = toArray(args['remove-label']);
  const clearLabels = Boolean(args['clear-labels']);

  if (clearLabels) {
    updates.labels = [];
  } else if (addLabels.length || removeLabels.length) {
    const set = new Set(current.labels ?? []);
    for (const l of addLabels) set.add(l);
    for (const l of removeLabels) set.delete(l);
    updates.labels = Array.from(set);
  }

  if (Object.keys(updates).length === 0) {
    console.log(chalk.yellow('No changes specified. See --help for options.'));
    return;
  }

  try {
    const updated = await storage.updateTicket(id, updates);
    if (!updated) {
      console.log(chalk.red(`Failed to update ticket "${id}".`));
      process.exit(1);
    }

    await notifier.notifyTicketUpdated(updated);

    console.log(chalk.green.bold('✓ Ticket updated!'));
    console.log();
    console.log(chalk.white.bold(updated.title));
    console.log(chalk.gray(`  ID: ${updated.id}`));
    if (updated.priority) console.log(chalk.gray(`  Priority: `) + chalk.yellow(updated.priority));
    if (updated.estimate !== undefined) console.log(chalk.gray(`  Estimate: ${updated.estimate}`));
    if (updated.labels && updated.labels.length) console.log(chalk.gray(`  Labels: ${updated.labels.join(', ')}`));
    if (updated.description) {
      console.log();
      console.log(chalk.gray('  Description:'));
      console.log('  ' + updated.description);
    }
  } catch (error) {
    console.log(chalk.red(`Error editing ticket: ${error instanceof Error ? error.message : 'Unknown error'}`));
    process.exit(1);
  }
}
