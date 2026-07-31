import chalk from 'chalk';
import type minimist from 'minimist';
import { createStorage } from '../../core/storage.js';
import type { Epic, Sprint, Ticket, TicketStatus, User } from '../../core/types.js';

interface ShowArgs extends minimist.ParsedArgs {
  _: string[];
}

export async function showTicket(args: ShowArgs): Promise<void> {
  const [, id] = args._;

  if (!id) {
    console.log(chalk.red('Error: Please provide an entity ID'));
    console.log(chalk.dim('Usage: tkxr show <id>  (ticket, sprint, epic, or user)'));
    return;
  }

  const storage = await createStorage();

  try {
    const result = await storage.findEntity(id);

    if (!result) {
      console.log(chalk.red(`Entity '${id}' not found`));
      return;
    }

    const { entity, type } = result;

    if (type === 'tasks' || type === 'bugs') {
      await renderTicket(storage, entity as Ticket);
    } else if (type === 'sprints') {
      renderSprint(entity as Sprint);
    } else if (type === 'epics') {
      await renderEpic(storage, entity as Epic);
    } else if (type === 'users') {
      renderUser(entity as User);
    } else {
      console.log(chalk.red(`Unknown entity type: ${type}`));
    }
  } catch (error) {
    console.log(chalk.red(`Error showing entity: ${error instanceof Error ? error.message : 'Unknown error'}`));
  }
}

async function renderTicket(storage: any, ticket: Ticket): Promise<void> {
  const users = await storage.getUsers();
  const sprints = await storage.getSprints();
  const epics = await storage.getEpics();

  const getEpicName = (epicId: string | undefined) => {
    if (!epicId) return undefined;
    const epic = epics.find((e: Epic) => e.id === epicId);
    return epic?.name || epicId;
  };

  const getUserDisplayName = (userId: string | undefined) => {
    if (!userId) return undefined;
    const user = users.find((u: User) => u.id === userId);
    return user?.displayName || userId;
  };

  const getSprintName = (sprintId: string | undefined) => {
    if (!sprintId) return undefined;
    const sprint = sprints.find((s: Sprint) => s.id === sprintId);
    return sprint?.name || sprintId;
  };

  const statusColors: Record<TicketStatus, (text: string) => string> = {
    backlog: chalk.gray,
    progress: chalk.yellow,
    review: chalk.blue,
    blocked: chalk.red,
    done: chalk.green,
  };

  const priorityColors = {
    low: chalk.blue,
    medium: chalk.yellow,
    high: chalk.magenta,
    critical: chalk.red,
  };

  const typeIcon = ticket.type === 'task' ? '📋' : '🐛';
  const statusColor = statusColors[ticket.status] || chalk.white;
  const priorityColor = ticket.priority ? priorityColors[ticket.priority] || chalk.white : chalk.white;

  console.log();
  console.log(chalk.bold(`${typeIcon} ${ticket.title}`));
  console.log(chalk.dim('─'.repeat(50)));
  console.log(`${chalk.blue('ID:')}        ${ticket.id}`);
  console.log(`${chalk.blue('Type:')}      ${ticket.type}`);
  console.log(`${chalk.blue('Status:')}    ${statusColor(ticket.status)}`);

  if (ticket.priority) {
    console.log(`${chalk.blue('Priority:')}  ${priorityColor(ticket.priority)}`);
  }

  if (ticket.assignee) {
    console.log(`${chalk.blue('Assignee:')}  ${getUserDisplayName(ticket.assignee)}`);
  }

  if (ticket.sprint) {
    console.log(`${chalk.blue('Sprint:')}    ${getSprintName(ticket.sprint)}`);
  }

  if (ticket.epic) {
    console.log(`${chalk.blue('Epic:')}      ${getEpicName(ticket.epic)}`);
  }

  if (ticket.estimate) {
    console.log(`${chalk.blue('Estimate:')}  ${ticket.estimate} ${ticket.estimate === 1 ? 'point' : 'points'}`);
  }

  if (ticket.labels && ticket.labels.length > 0) {
    console.log(`${chalk.blue('Labels:')}    ${ticket.labels.join(', ')}`);
  }

  if (ticket.description) {
    console.log();
    console.log(chalk.blue('Description:'));
    console.log(ticket.description);
  }

  console.log();
  console.log(chalk.dim(`Created: ${new Date(ticket.createdAt).toLocaleString()}`));
  console.log(chalk.dim(`Updated: ${new Date(ticket.updatedAt).toLocaleString()}`));
  console.log();
}

function renderSprint(sprint: Sprint): void {
  const statusColors = {
    planning: chalk.yellow,
    active: chalk.blue,
    completed: chalk.green,
  } as const;
  const statusColor = statusColors[sprint.status] || chalk.white;

  console.log();
  console.log(chalk.bold(`🏃 ${sprint.name}`));
  console.log(chalk.dim('─'.repeat(50)));
  console.log(`${chalk.blue('ID:')}        ${sprint.id}`);
  console.log(`${chalk.blue('Status:')}    ${statusColor(sprint.status)}`);
  if (sprint.goal) console.log(`${chalk.blue('Goal:')}      ${sprint.goal}`);
  if (sprint.startDate) console.log(`${chalk.blue('Start:')}     ${new Date(sprint.startDate).toLocaleDateString()}`);
  if (sprint.endDate) console.log(`${chalk.blue('End:')}       ${new Date(sprint.endDate).toLocaleDateString()}`);
  if (sprint.description) {
    console.log();
    console.log(chalk.blue('Description:'));
    console.log(sprint.description);
  }
  console.log();
  console.log(chalk.dim(`Created: ${new Date(sprint.createdAt).toLocaleString()}`));
  console.log(chalk.dim(`Updated: ${new Date(sprint.updatedAt).toLocaleString()}`));
  console.log();
}

async function renderEpic(storage: any, epic: Epic): Promise<void> {
  const statusColors = {
    planning: chalk.yellow,
    active: chalk.blue,
    completed: chalk.green,
  } as const;
  const statusColor = statusColors[epic.status] || chalk.white;

  const sprints = await storage.getSprints();
  const sprint = epic.sprint ? sprints.find((s: Sprint) => s.id === epic.sprint) : undefined;
  const tickets: Ticket[] = await storage.getAllTickets();
  const scoped = tickets.filter(t => t.epic === epic.id);
  const done = scoped.filter(t => t.status === 'done').length;
  const points = scoped.reduce((s, t) => s + (t.estimate || 0), 0);

  console.log();
  console.log(chalk.bold(`🎯 ${epic.name}`));
  console.log(chalk.dim('─'.repeat(50)));
  console.log(`${chalk.blue('ID:')}        ${epic.id}`);
  console.log(`${chalk.blue('Status:')}    ${statusColor(epic.status)}`);
  console.log(`${chalk.blue('Sprint:')}    ${epic.sprint ? (sprint?.name || epic.sprint) : chalk.dim('none')}`);
  if (epic.goal) console.log(`${chalk.blue('Goal:')}      ${epic.goal}`);
  console.log(`${chalk.blue('Tickets:')}   ${scoped.length} (${done} done, ${points} pts)`);
  if (epic.description) {
    console.log();
    console.log(chalk.blue('Description:'));
    console.log(epic.description);
  }
  console.log();
  console.log(chalk.dim(`Created: ${new Date(epic.createdAt).toLocaleString()}`));
  console.log(chalk.dim(`Updated: ${new Date(epic.updatedAt).toLocaleString()}`));
  console.log();
}

function renderUser(user: User): void {
  console.log();
  console.log(chalk.bold(`👤 ${user.displayName} (@${user.username})`));
  console.log(chalk.dim('─'.repeat(50)));
  console.log(`${chalk.blue('ID:')}       ${user.id}`);
  console.log(`${chalk.blue('Username:')} ${user.username}`);
  console.log(`${chalk.blue('Name:')}     ${user.displayName}`);
  if (user.email) console.log(`${chalk.blue('Email:')}    ${user.email}`);
  console.log();
  console.log(chalk.dim(`Created: ${new Date(user.createdAt).toLocaleString()}`));
  console.log(chalk.dim(`Updated: ${new Date(user.updatedAt).toLocaleString()}`));
  console.log();
}
