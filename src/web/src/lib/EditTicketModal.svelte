<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import X from './icons/X.svelte';
	import Bug from './icons/Bug.svelte';
	import CheckSquare from './icons/CheckSquare.svelte';
	import { sprintStore, userStore, type Ticket } from './stores';

	const dispatch = createEventDispatcher();

	export let ticket: Ticket;

	let formData = {
		type: ticket.type,
		title: ticket.title,
		description: ticket.description || '',
		assignee: ticket.assignee || '',
		sprint: ticket.sprint || '',
		priority: ticket.priority || 'medium',
		estimate: ticket.estimate?.toString() || '',
		status: ticket.status
	};

	let isSubmitting = false;

	async function handleSubmit() {
		if (!formData.title.trim()) return;
		
		isSubmitting = true;

		try {
			const payload = {
				...formData,
				title: formData.title.trim(),
				description: formData.description?.trim() || undefined,
				assignee: formData.assignee || undefined,
				sprint: formData.sprint || undefined,
				estimate: formData.estimate ? parseInt(formData.estimate) : undefined
			};

			const response = await fetch(`/api/tickets/${ticket.id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});

			if (response.ok) {
				dispatch('updated');
				dispatch('close');
			} else {
				const error = await response.json();
				console.error('Failed to update ticket:', error);
			}
		} catch (error) {
			console.error('Failed to update ticket:', error);
		} finally {
			isSubmitting = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			dispatch('close');
		}
	}

	function handleClose() {
		dispatch('close');
	}
</script>

<svelte:window on:keydown={handleKeydown} />

<!-- Backdrop -->
<div 
	class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
	on:click={(e) => { if (e.target === e.currentTarget) handleClose(); }}
	on:keydown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) handleClose(); }}
	role="dialog"
	aria-modal="true"
>
	<!-- Modal -->
	<section
		class="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg mx-auto"
		role="dialog"
		aria-modal="true"
	>
		<!-- Header -->
		<div class="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
			<h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100">Edit Ticket</h2>
			<button 
				class="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
				on:click={handleClose}
			>
				<X size={24} />
			</button>
		</div>

		<!-- Form -->
		<form on:submit|preventDefault={handleSubmit} class="p-6">
			<!-- Type Selection -->
			<div class="mb-4">
				<label for="edit-type-task" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Type</label>
				<div class="flex gap-3">
					<button
						id="edit-type-task"
						type="button"
						class="flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors {formData.type === 'task' 
							? 'border-blue-500 bg-blue-50 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300' 
							: 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500 text-gray-700 dark:text-gray-300'}"
						on:click={() => formData.type = 'task'}
						aria-pressed={formData.type === 'task'}
					>
						<CheckSquare size={18} />
						<span class="font-medium">Task</span>
					</button>

					<button
						id="edit-type-bug"
						type="button"
						class="flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors {formData.type === 'bug' 
							? 'border-red-500 bg-red-50 dark:bg-red-900/50 text-red-700 dark:text-red-300' 
							: 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500 text-gray-700 dark:text-gray-300'}"
						on:click={() => formData.type = 'bug'}
						aria-pressed={formData.type === 'bug'}
					>
						<Bug size={18} />
						<span class="font-medium">Bug</span>
					</button>
				</div>
			</div>

			<!-- Title -->
			<div class="mb-4">
				<label for="edit-title" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
					Title *
				</label>
				<input
					id="edit-title"
					type="text"
					bind:value={formData.title}
					required
					class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
					placeholder="Enter ticket title..."
				>
			</div>

			<!-- Description -->
			<div class="mb-4">
				<label for="edit-description" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
					Description
				</label>
				<textarea
					id="edit-description"
					bind:value={formData.description}
					rows="3"
					class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
					placeholder="Enter ticket description..."
				></textarea>
			</div>

			<!-- Status -->
			<div class="mb-4">
				<label for="edit-status" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
					Status
				</label>
				<select
					id="edit-status"
					bind:value={formData.status}
					class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
				>
					<option value="todo">To Do</option>
					<option value="progress">In Progress</option>
					<option value="done">Done</option>
				</select>
			</div>

			<!-- Priority -->
			<div class="mb-4">
				<label for="edit-priority" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
					Priority
				</label>
				<select
					id="edit-priority"
					bind:value={formData.priority}
					class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
				>
					<option value="low">Low</option>
					<option value="medium">Medium</option>
					<option value="high">High</option>
					<option value="critical">Critical</option>
				</select>
			</div>

			<!-- Assignee -->
			<div class="mb-4">
				<label for="edit-assignee" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
					Assignee
				</label>
				<select
					id="edit-assignee"
					bind:value={formData.assignee}
					class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
				>
					<option value="">Unassigned</option>
					{#each $userStore as user}
						<option value={user.id}>{user.displayName} (@{user.username})</option>
					{/each}
				</select>
			</div>

			<!-- Sprint -->
			<div class="mb-4">
				<label for="edit-sprint" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
					Sprint
				</label>
				<select
					id="edit-sprint"
					bind:value={formData.sprint}
					class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
				>
					<option value="">No sprint</option>
					{#each $sprintStore.filter(s => s.status !== 'completed') as sprint}
						<option value={sprint.id}>{sprint.name}</option>
					{/each}
				</select>
			</div>

			<!-- Estimate -->
			<div class="mb-6">
				<label for="edit-estimate" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
					Story Points
				</label>
				<input
					id="edit-estimate"
					type="number"
					bind:value={formData.estimate}
					min="0"
					max="100"
					class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
					placeholder="Enter story points..."
				>
			</div>

			<!-- Actions -->
			<div class="flex gap-3 justify-end">
				<button
					type="button"
					class="btn btn-secondary"
					on:click={() => dispatch('close')}
				>
					Cancel
				</button>
				<button
					type="submit"
					class="btn btn-primary"
					disabled={!formData.title.trim() || isSubmitting}
				>
					{#if isSubmitting}
						Updating...
					{:else}
						Update Ticket
					{/if}
				</button>
			</div>
		</form>
	</section>
</div>