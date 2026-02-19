import chalk from 'chalk';
import type minimist from 'minimist';
import { FileStorage } from '../../core/storage.js';

interface SprintArgs extends minimist.ParsedArgs {
  _: string[];
  description?: string;
  goal?: string;
  'start-date'?: string;
  'end-date'?: string;
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
  console.log('  create <name>              Create a new sprint');
  console.log('  status <id> <status>       Update sprint status');
  console.log();
  console.log(chalk.green('Options:'));
  console.log('  --description <text>       Sprint description (optional)');
  console.log('  --goal <text>             Sprint goal (optional)');
  console.log('  --start-date <date>       Start date (optional)');
  console.log('  --end-date <date>         End date (optional)');
  console.log();
  console.log(chalk.green('Status values:'));
  console.log('  planning, active, completed');
  console.log();
  console.log(chalk.green('Examples:'));
  console.log('  tkxr sprint create "Sprint 1"');
  console.log('  tkxr sprint create "Feature Sprint" --description "Add new features" --goal "Complete user auth"');
  console.log('  tkxr sprint status spr-abc123 active');
}

async function createSprint(rest: string[], args: SprintArgs): Promise<void> {
  const [name] = rest;
  
  if (!name) {
    console.error(chalk.red('Sprint name is required.'));
    console.log(chalk.gray('Usage: tkxr sprint create <name>'));
    process.exit(1);
  }

  try {
    const storage = new FileStorage();
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
    const storage = new FileStorage();
    const sprint = await storage.updateSprintStatus(id, status as any);

    if (!sprint) {
      console.error(chalk.red(`Sprint with ID "${id}" not found.`));
      process.exit(1);
    }

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