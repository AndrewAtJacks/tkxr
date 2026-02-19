<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import Bug from './icons/Bug.svelte';
	import CheckSquare from './icons/CheckSquare.svelte';
	import Clock from './icons/Clock.svelte';
	import Done from './icons/Check.svelte';
	import User from './icons/User.svelte';
	import Calendar from './icons/Calendar.svelte';
	import Edit from './icons/Edit.svelte';
	import Trash from './icons/Trash.svelte';
	import type { Ticket } from './stores';

	export let ticket: Ticket;

	const dispatch = createEventDispatcher();

	const statusConfig = {
		todo: { icon: Clock, color: 'text-gray-600', bg: 'bg-gray-100', label: 'To Do' },
		progress: { icon: Clock, color: 'text-yellow-600', bg: 'bg-yellow-100', label: 'In Progress' },
		done: { icon: Done, color: 'text-green-600', bg: 'bg-green-100', label: 'Done' }
	};

	const priorityConfig = {
		low: { color: 'text-blue-600', bg: 'bg-blue-100' },
		medium: { color: 'text-yellow-600', bg: 'bg-yellow-100' },
		high: { color: 'text-orange-600', bg: 'bg-orange-100' },
		critical: { color: 'text-red-600', bg: 'bg-red-100' }
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

<div class="card hover:shadow-md transition-shadow">
	<!-- Header -->
	<div class="flex items-start justify-between mb-3">
		<div class="flex items-center gap-2">
			<TypeIcon 
				size={18} 
				class={ticket.type === 'bug' ? 'text-red-600' : 'text-blue-600'} 
			/>
			<span class="text-sm font-mono text-gray-500">{ticket.id}</span>
		</div>
		
		{#if ticket.priority}
			<span class="px-2 py-1 text-xs font-medium rounded-full {priorityConfig[ticket.priority].color} {priorityConfig[ticket.priority].bg}">
				{ticket.priority}
			</span>
		{/if}
	</div>

	<!-- Title & Actions -->
	<div class="flex items-start justify-between mb-2">
		<h3 class="font-semibold text-gray-900 flex-1 line-clamp-2">
			{ticket.title}
		</h3>
		<div class="flex gap-1 ml-2">
			<button 
				class="p-1.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50"
				title="Edit ticket"
				on:click={() => dispatch('edit')}
			>
				<Edit size={14} />
			</button>
			<button 
				class="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
				title="Delete ticket"
				on:click={deleteTicket}
			>
				<Trash size={14} />
			</button>
		</div>
	</div>

	<!-- Description -->
	{#if ticket.description}
		<p class="text-sm text-gray-600 mb-3 line-clamp-2">
			{ticket.description}
		</p>
	{/if}

	<!-- Metadata -->
	<div class="space-y-2 mb-4">
		{#if ticket.assignee}
			<div class="flex items-center gap-2 text-sm text-gray-600">
				<User size={16} />
				<span>{ticket.assignee}</span>
			</div>
		{/if}

		{#if ticket.sprint}
			<div class="flex items-center gap-2 text-sm text-gray-600">
				<Calendar size={16} />
				<span>{ticket.sprint}</span>
			</div>
		{/if}

		{#if ticket.estimate}
			<div class="text-sm text-gray-600">
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
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-2">
			<svelte:component 
				this={currentStatus.icon} 
				size={16} 
				class={currentStatus.color} 
			/>
			<span class="text-sm font-medium {currentStatus.color}">
				{currentStatus.label}
			</span>
		</div>

		<!-- Quick Status Updates -->
		<div class="flex gap-1">
			{#if ticket.status !== 'todo'}
				<button 
					class="p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100"
					title="Mark as To Do"
					on:click={() => updateStatus('todo')}
				>
					<Clock size={16} />
				</button>
			{/if}
			
			{#if ticket.status !== 'progress'}
				<button 
					class="p-1.5 rounded text-yellow-400 hover:text-yellow-600 hover:bg-yellow-50"
					title="Mark as In Progress"
					on:click={() => updateStatus('progress')}
				>
					<Clock size={16} />
				</button>
			{/if}
			
			{#if ticket.status !== 'done'}
				<button 
					class="p-1.5 rounded text-green-400 hover:text-green-600 hover:bg-green-50"
					title="Mark as Done"
					on:click={() => updateStatus('done')}
				>
					<Done size={16} />
				</button>
			{/if}
		</div>
	</div>

	<!-- Timestamp -->
	<div class="text-xs text-gray-400 mt-2">
		Updated {new Date(ticket.updatedAt).toLocaleDateString()}
	</div>
</div>

<style>
	.line-clamp-2 {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
</style>