<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { Ticket } from './stores';
	import TicketCard from './TicketCard.svelte';
	import Bug from './icons/Bug.svelte';
	import CheckSquare from './icons/CheckSquare.svelte';
	import Clock from './icons/Clock.svelte';
	import Done from './icons/Check.svelte';
	import Plus from './icons/Plus.svelte';

	export let tickets: Ticket[];
	export let onUpdateTicket: (ticket: Ticket) => void;

	const dispatch = createEventDispatcher();

	// Group tickets by status
	$: groupedTickets = {
		todo: tickets.filter(t => t.status === 'todo'),
		progress: tickets.filter(t => t.status === 'progress'),
		done: tickets.filter(t => t.status === 'done')
	};

	// Add ticket to specific status when clicking add button
	function addTicketToColumn(status: 'todo' | 'progress' | 'done') {
		dispatch('createTicket', { status });
	}

	// Handle drag and drop
	let draggedTicket: Ticket | null = null;
	let dragCounter = 0;
	
	// Keyboard navigation state
	let selectedTicketIndex = -1;
	let selectedColumn = 0;

	function handleDragStart(event: DragEvent, ticket: Ticket) {
		draggedTicket = ticket;
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/html', ''); // Required for Firefox
		}
	}

	function handleDragEnd() {
		draggedTicket = null;
		dragCounter = 0;
	}

	function handleDragOver(event: DragEvent) {
		event.preventDefault();
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'move';
		}
	}

	function handleDragEnter(event: DragEvent) {
		event.preventDefault();
		dragCounter++;
	}

	function handleDragLeave() {
		dragCounter--;
	}

	async function handleDrop(event: DragEvent, newStatus: 'todo' | 'progress' | 'done') {
		event.preventDefault();
		dragCounter = 0;
		
		if (!draggedTicket || draggedTicket.status === newStatus) {
			return;
		}

		try {
			// Update ticket status
			const response = await fetch(`/api/tickets/${draggedTicket.id}/status`, {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ status: newStatus })
			});

			if (response.ok) {
				dispatch('updated');
			}
		} catch (error) {
			console.error('Failed to update ticket status:', error);
		}

		draggedTicket = null;
	}

	// Column configuration
	const columns = [
		{
			status: 'todo',
			title: 'To Do', 
			icon: CheckSquare,
			bgClass: 'bg-gray-50 dark:bg-gray-800',
			headerClass: 'text-gray-600 dark:text-gray-300'
		},
		{
			status: 'progress',
			title: 'In Progress',
			icon: Clock, 
			bgClass: 'bg-blue-50 dark:bg-blue-900/20',
			headerClass: 'text-blue-600 dark:text-blue-400'
		},
		{
			status: 'done',
			title: 'Done',
			icon: Done,
			bgClass: 'bg-green-50 dark:bg-green-900/20', 
			headerClass: 'text-green-600 dark:text-green-400'
		}
	] as const;
</script>

<section class="kanban-board" role="application" aria-label="Kanban board for ticket management">
	<div class="sr-only" aria-live="polite" id="kanban-instructions">
		Use arrow keys to move tickets between columns. Press Enter or Space to select a ticket.
	</div>
	{#each columns as column, columnIndex}
		<div 
			class="kanban-column flex flex-col {column.bgClass} rounded-lg p-4"
			on:dragover={handleDragOver}
			on:dragenter={handleDragEnter}
			on:dragleave={handleDragLeave}
			on:drop={(e) => handleDrop(e, column.status)}
			class:drag-over={dragCounter > 0 && draggedTicket?.status !== column.status}
			role="region"
			aria-labelledby="column-header-{column.status}"
			aria-describedby="column-desc-{column.status}"
		>
			<!-- Column Header -->
			<header class="flex items-center justify-between mb-4">
				<div class="flex items-center gap-2">
					<svelte:component this={column.icon} class="w-5 h-5 {column.headerClass}" aria-hidden="true" />
					<h2 id="column-header-{column.status}" class="font-semibold {column.headerClass}">
						{column.title}
					</h2>
					<span class="text-sm bg-white dark:bg-gray-700 px-2 py-1 rounded-full {column.headerClass}" 
						  aria-label="{groupedTickets[column.status].length} tickets">
						{groupedTickets[column.status].length}
					</span>
				</div>
				
				<div id="column-desc-{column.status}" class="sr-only">
					Column for {column.title} tickets. Contains {groupedTickets[column.status].length} tickets.
				</div>
				
				<!-- Add button for each column -->
				<button
					class="p-2 hover:bg-white/50 dark:hover:bg-gray-700/50 rounded-lg transition-colors"
					on:click={() => addTicketToColumn(column.status)}
					title="Add ticket to {column.title}"
					aria-label="Add new ticket to {column.title} column"
				>
					<Plus class="w-4 h-4 {column.headerClass}" aria-hidden="true" />
				</button>
			</header>

			<!-- Tickets in this column -->
			<div class="flex-1 space-y-3 overflow-y-auto" role="list" aria-label="{column.title} tickets">
				{#each groupedTickets[column.status] as ticket, ticketIndex (ticket.id)}
					<button 
						type="button"
						draggable="true"
						on:dragstart={(e) => handleDragStart(e, ticket)}
						on:dragend={handleDragEnd}
						on:keydown={(e) => handleKeydown(e, ticket, ticketIndex, column.status)}
						class="kanban-ticket cursor-move transition-transform hover:scale-[1.02] active:scale-95"
						class:opacity-50={draggedTicket === ticket}
						class:ring-2={selectedTicketIndex === ticketIndex && selectedColumn === columnIndex}
						class:ring-blue-500={selectedTicketIndex === ticketIndex && selectedColumn === columnIndex}
						aria-label="Ticket: {ticket.title}. Press Enter to move to next column or use arrow keys to move between columns."
						aria-describedby="kanban-instructions"
						tabindex="0"
					>
						<TicketCard 
							{ticket} 
							on:updated={() => dispatch('updated')}
							on:edit={() => dispatch('edit', ticket)}
							on:comments={() => dispatch('comments', ticket)}
						/>
					</button>
				{/each}
				
				{#if groupedTickets[column.status].length === 0}
					<div class="text-center py-8 text-gray-400 dark:text-gray-500" role="status" aria-live="polite">
						<svelte:component this={column.icon} class="w-8 h-8 mx-auto mb-2 opacity-50" aria-hidden="true" />
						<p class="text-sm">No {column.title.toLowerCase()} tickets</p>
						<button 
							class="mt-2 text-xs px-3 py-1 bg-white/50 dark:bg-gray-700/50 rounded-lg hover:bg-white/70 dark:hover:bg-gray-700/70 transition-colors"
							on:click={() => addTicketToColumn(column.status)}
							aria-label="Add first ticket to {column.title} column"
						>
							Add first ticket
						</button>
					</div>
				{/if}
			</div>
		</div>
	{/each}
</section>

<style>
	.kanban-board {
		display: flex;
		gap: 1.5rem;
		overflow-x: auto;
		overflow-y: hidden;
		padding-bottom: 0.5rem;
		min-height: calc(100vh - 280px);
	}
	
	.kanban-column {
		flex: 1;
		min-width: 280px;

		min-height: 500px;
		transition: all 0.2s ease-in-out;
	}

	/* Mobile: stack columns vertically */
	@media (max-width: 768px) {
		.kanban-board {
			flex-direction: column;
			overflow-x: hidden;
			overflow-y: auto;
		}
		
		.kanban-column {
			min-width: 100%;
			max-width: 100%;
			min-height: 300px;
		}
	}
	
	.kanban-column.drag-over {
		border: 2px solid rgba(96, 165, 250, 0.5);
		transform: scale(1.02);
		box-shadow: 0 0 0 1px rgb(96, 165, 250, 0.5);
	}
	
	:global(.dark) .kanban-column.drag-over {
		border-color: rgb(59, 130, 246);
		box-shadow: 0 0 0 1px rgb(59, 130, 246, 0.5);
	}
	
	.kanban-ticket {
		transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
	}
</style>
