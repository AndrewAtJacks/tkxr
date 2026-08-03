import chalk from 'chalk';
import type minimist from 'minimist';
import { createStorage } from '../../core/storage.js';

interface SprintsArgs extends minimist.ParsedArgs {
  _: string[];
  status?: 'planning' | 'active' | 'completed';
  archived?: boolean;
  a?: boolean;
}

export async function listSprints(args: SprintsArgs): Promise<void> {
  try {
    const storage = await createStorage();
    let sprints = await storage.getSprints();

    // Filter by status if provided
    if (args.status) {
      sprints = sprints.filter(sprint => sprint.status === args.status);
    }

    // Get archived sprints if requested
    const archived = args.archived || args.a ? await storage.getArchivedSprints() : [];

    if (sprints.length === 0 && archived.length === 0) {
      const statusText = args.status ? ` with status "${args.status}"` : '';
      console.log(chalk.yellow(`No sprints found${statusText}.`));
      return;
    }

    // Sprints, grouped by lifecycle so finished work sinks to the bottom
    // instead of interleaving with what's in flight — same ordering the web
    // switcher uses. Newest first within a group.
    if (sprints.length > 0) {
      const progress = await storage.getSprintProgress();
      const statusText = args.status ? ` (${args.status})` : '';
      console.log(chalk.blue.bold(`Found ${sprints.length} sprint${sprints.length === 1 ? '' : 's'}${statusText}:`));
      console.log();

      const GROUPS: { status: 'active' | 'planning' | 'completed'; heading: string }[] = [
        { status: 'active', heading: 'In flight' },
        { status: 'planning', heading: 'Planning' },
        { status: 'completed', heading: 'Completed' },
      ];

      for (const group of GROUPS) {
        const inGroup = sprints
          .filter(s => s.status === group.status)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        if (inGroup.length === 0) continue;

        // A single-status listing is already labelled by the header above.
        if (!args.status) {
          console.log(chalk.bold.underline(`${group.heading} (${inGroup.length})`));
          console.log();
        }

        for (const sprint of inGroup) {
          const statusColor =
            sprint.status === 'completed' ? 'green' :
            sprint.status === 'active' ? 'blue' : 'yellow';
          const p = progress[sprint.id] || { total: 0, done: 0, open: 0 };
          // A sprint whose tickets are all done but is still open is the exact
          // case the web UI prompts on — flag it here too.
          const ready = p.total > 0 && p.open === 0 && sprint.status !== 'completed';

          console.log(chalk.white.bold(sprint.name));
          console.log(chalk.gray(`  ID: ${sprint.id}`));
          console.log(chalk.gray(`  Status: `) + chalk[statusColor](sprint.status));
          console.log(chalk.gray(`  Tickets: ${p.done}/${p.total} done`));
          if (ready) {
            console.log(chalk.green(`  ✓ All tickets done — "tkxr sprint complete ${sprint.id}"`));
          }
          if (sprint.description) {
            console.log(chalk.gray(`  Description: ${sprint.description}`));
          }
          if (sprint.goal) {
            console.log(chalk.gray(`  Goal: ${sprint.goal}`));
          }
          console.log(chalk.gray(`  Created: ${new Date(sprint.createdAt).toLocaleDateString()}`));
          if (sprint.startDate) {
            console.log(chalk.gray(`  Start Date: ${new Date(sprint.startDate).toLocaleDateString()}`));
          }
          if (sprint.endDate) {
            console.log(chalk.gray(`  End Date: ${new Date(sprint.endDate).toLocaleDateString()}`));
          }
          console.log();
        }
      }
    }
    
    // Archived sprints
    if ((args.archived || args.a) && archived.length > 0) {
      if (sprints.length > 0) console.log('─'.repeat(50)); // Add separator
      console.log(chalk.blue.bold(`📁 Archived Sprints (${archived.length}):`));
      console.log();
      
      for (const sprintId of archived) {
        console.log(chalk.white.bold(`Sprint Archive: ${sprintId}`));
        console.log(chalk.gray(`  Archive File: tkxr/archives/archive-${sprintId}.yaml`));
        console.log(chalk.gray(`  Status: `) + chalk.green('completed'));
        console.log();
      }
    }
    
  } catch (error) {
    console.error(chalk.red('Error listing sprints:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}