<script lang="ts">
	import { createEventDispatcher, onMount, afterUpdate } from 'svelte';
	import Bug from './icons/Bug.svelte';
	import CheckSquare from './icons/CheckSquare.svelte';
	import Clock from './icons/Clock.svelte';
	import Done from './icons/Check.svelte';
	import User from './icons/User.svelte';
	import Calendar from './icons/Calendar.svelte';
	import Edit from './icons/Edit.svelte';
	import Trash from './icons/Trash.svelte';
	import MessageSquare from './icons/MessageSquare.svelte';
	import ChevronDown from './icons/ChevronDown.svelte';
	import type { Ticket } from './stores';
	import { userStore, sprintStore } from './stores';

	export let ticket: Ticket;

	const dispatch = createEventDispatcher();

	// Expand/collapse state
	let isExpanded = false;
	let titleElement: HTMLElement;
	let descriptionElement: HTMLElement;
	let isTitleTruncated = false;
	let isDescriptionTruncated = false;

	// Check if content is truncated
	$: showExpandButton = isExpanded || isTitleTruncated || isDescriptionTruncated;

	function checkTruncation() {
		if (titleElement) {
			isTitleTruncated = titleElement.scrollHeight > titleElement.clientHeight;
		}
		if (descriptionElement) {
			isDescriptionTruncated = descriptionElement.scrollHeight > descriptionElement.clientHeight;
		}
	}

	function toggleExpanded() {
		isExpanded = !isExpanded;
	}

	// Check truncation when component mounts and updates
	onMount(checkTruncation);
	afterUpdate(checkTruncation);

	// Helper functions to get display names
	$: getUserDisplayName = (userId: string | undefined) => {
		if (!userId) return undefined;
		const user = $userStore.find(u => u.id === userId);
		return user?.displayName || userId;
	};

	$: getSprintName = (sprintId: string | undefined) => {
		if (!sprintId) return undefined;
		const sprint = $sprintStore.find(s => s.id === sprintId);
		return sprint?.name || sprintId;
	};

	const statusConfig = {
		todo: { icon: Clock, color: 'text-gray-600 dark:text-gray-300', bg: 'bg-gray-100 dark:bg-gray-700', label: 'To Do' },
		progress: { icon: Clock, color: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-100 dark:bg-yellow-900', label: 'In Progress' },
		done: { icon: Done, color: 'text-green-600 dark:text-green-400', bg: 'bg-green-100 dark:bg-green-900', label: 'Done' }
	};

	const priorityConfig = {
		low: { color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-100 dark:bg-blue-900' },
		medium: { color: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-100 dark:bg-yellow-900' },
		high: { color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-100 dark:bg-orange-900' },
		critical: { color: 'text-red-600 dark:text-red-400', bg: 'bg-red-100 dark:bg-red-900' }
	};

	async function updateStatus(newStatus: Ticket['status']) {
		try {
			const response = await fetch(`/api/tickets/${ticket.id}/status`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: newStatus })
			});

			if (response.ok) {
				ticket.status = newStatus;
				dispatch('updated');
			}
		} catch (error) {
			console.error('Failed to update ticket status:', error);
		}
	}

	async function deleteTicket() {
		if (!confirm(`Are you sure you want to delete "${ticket.title}"?`)) {
			return;
		}
		
		try {
			const response = await fetch(`/api/tickets/${ticket.id}`, {
				method: 'DELETE'
			});

			if (response.ok) {
				dispatch('updated');
			}
		} catch (error) {
			console.error('Failed to delete ticket:', error);
		}
	}

	$: currentStatus = statusConfig[ticket.status];
	$: TypeIcon = ticket.type === 'bug' ? Bug : CheckSquare;
</script>

<div class="card hover:shadow-md transition-shadow" role="article" aria-labelledby="ticket-title-{ticket.id}">
	<!-- Header -->
	<div class="flex items-start justify-between mb-3">
		<div class="flex items-center gap-2">
			<TypeIcon 
				size={18} 
				class={ticket.type === 'bug' ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'}
				aria-hidden="true"
			/>
			<span class="text-sm font-mono text-gray-500 dark:text-gray-400" aria-label="Ticket ID">{ticket.id}</span>
			<span class="sr-only">{ticket.type === 'bug' ? 'Bug' : 'Task'}</span>
		</div>
		
		{#if ticket.priority}
			<span class="px-2 py-1 text-xs font-medium rounded-full {priorityConfig[ticket.priority].color} {priorityConfig[ticket.priority].bg}" 
				  aria-label="Priority: {ticket.priority}">
				{ticket.priority}
			</span>
		{/if}
	</div>

	<!-- Title & Actions -->
	<div class="flex items-start justify-between mb-2">
		<h3 
			id="ticket-title-{ticket.id}"
			bind:this={titleElement}
			class="font-semibold text-gray-900 dark:text-gray-100 flex-1 text-left{isExpanded ? '' : ' line-clamp-3'}"
		>
			{ticket.title}
		</h3>
		<div class="flex gap-1 ml-2" role="group" aria-label="Ticket actions for {ticket.title}">
			<button 
				class="p-1.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20"
				title="View comments for {ticket.title}"
				aria-label="View comments for ticket {ticket.id}"
				on:click={() => dispatch('comments')}
			>
				<MessageSquare size={14} aria-hidden="true" />
			</button>
			<button 
				class="p-1.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20"
				title="Edit {ticket.title}"
				aria-label="Edit ticket {ticket.id}"
				on:click={() => dispatch('edit')}
			>
				<Edit size={14} aria-hidden="true" />
			</button>
			<button 
				class="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
				title="Delete {ticket.title}"
				aria-label="Delete ticket {ticket.id}"
				on:click={deleteTicket}
			>
				<Trash size={14} aria-hidden="true" />
			</button>
		</div>
	</div>

	<!-- Description -->
	{#if ticket.description}
		<p 
			bind:this={descriptionElement}
			class="text-sm text-gray-600 dark:text-gray-300 mb-1 text-left{isExpanded ? '' : ' line-clamp-3'}"
		>
			{ticket.description}
		</p>
	{/if}

	<!-- Expand/Collapse button -->
	{#if showExpandButton}
		<button 
			on:click={toggleExpanded}
			class="inline-flex items-center mb-3 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors"
			title={isExpanded ? 'Collapse content' : 'Expand content'}
			aria-expanded={isExpanded}
			aria-controls="ticket-content-{ticket.id}"
			aria-label={isExpanded ? 'Show less content for ticket' : 'Show more content for ticket'}
		>
			<ChevronDown 
				size={16} 
				class="mr-1 transition-transform duration-200 {isExpanded ? 'rotate-180' : ''}" 
				aria-hidden="true"
			/>
			{isExpanded ? 'Show less' : 'Show more'}
		</button>
	{/if}

	<!-- Metadata -->
	<div id="ticket-content-{ticket.id}" class="space-y-2 mb-4 text-left" aria-label="Ticket metadata">
		{#if ticket.assignee}
			<div class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
				<User size={16} aria-hidden="true" />
				<span aria-label="Assigned to">{getUserDisplayName(ticket.assignee)}</span>
			</div>
		{/if}

		{#if ticket.sprint}
			<div class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
				<Calendar size={16} />
				<span>{getSprintName(ticket.sprint)}</span>
			</div>
		{/if}

		{#if ticket.estimate}
			<div class="text-sm text-gray-600 dark:text-gray-300">
				Estimate: {ticket.estimate} {ticket.estimate === 1 ? 'point' : 'points'}
			</div>
		{/if}
	</div>

	<!-- Labels -->
	{#if ticket.labels && ticket.labels.length > 0}
		<div class="flex flex-wrap gap-1 mb-3">
			{#each ticket.labels as label}
				<span class="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded-full">
					{label}
				</span>
			{/each}
		</div>
	{/if}

	<!-- Status & Actions -->
	<div class="flex items-center justify-between gap-2">
		<!-- Status icon and label - hidden on small screens -->
		<div class="hidden sm:flex items-center gap-2">
			<svelte:component 
				this={currentStatus.icon} 
				size={16} 
				class={currentStatus.color} 
			/>
			<span class="text-sm font-medium {currentStatus.color}">
				{currentStatus.label}
			</span>
		</div>

		<!-- Status Button Group - full width on small screens, auto width on larger screens -->
		<div class="flex-1 sm:flex-initial">
			<div class="inline-flex w-full sm:w-auto rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden" role="group" aria-label="Update ticket status">
				<button 
					class="flex-1 sm:flex-initial px-3 py-1.5 text-xs font-medium transition-colors
						{ticket.status === 'todo' 
							? 'bg-gray-200 text-gray-900 dark:bg-gray-600 dark:text-gray-100' 
							: 'bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'} 
						border-r border-gray-300 dark:border-gray-600"
					title="Mark as To Do"
					aria-pressed={ticket.status === 'todo'}
					on:click={() => updateStatus('todo')}
				>
					To Do
				</button>
				
				<button 
					class="flex-1 sm:flex-initial px-3 py-1.5 text-xs font-medium transition-colors
						{ticket.status === 'progress' 
							? 'bg-yellow-200 text-yellow-900 dark:bg-yellow-700 dark:text-yellow-100' 
							: 'bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'} 
						border-r border-gray-300 dark:border-gray-600"
					title="Mark as In Progress"
					aria-pressed={ticket.status === 'progress'}
					on:click={() => updateStatus('progress')}
				>
					In Progress
				</button>
				
				<button 
					class="flex-1 sm:flex-initial px-3 py-1.5 text-xs font-medium transition-colors
						{ticket.status === 'done' 
							? 'bg-green-200 text-green-900 dark:bg-green-700 dark:text-green-100' 
							: 'bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'}"
					title="Mark as Done"
					aria-pressed={ticket.status === 'done'}
					on:click={() => updateStatus('done')}
				>
					Done
				</button>
			</div>
		</div>
	</div>

	<!-- Timestamp -->
	<div class="text-xs text-gray-400 mt-2 text-left">
		Updated {new Date(ticket.updatedAt).toLocaleDateString()}
	</div>
</div>

<style>
	.line-clamp-2 {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
</style>