<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import X from './icons/X.svelte';
	import Bug from './icons/Bug.svelte';
	import CheckSquare from './icons/CheckSquare.svelte';
	import { sprintStore, userStore } from './stores';

	const dispatch = createEventDispatcher();

	let formData = {
		type: 'task' as 'task' | 'bug',
		title: '',
		description: '',
		assignee: '',
		sprint: '',
		priority: 'medium' as 'low' | 'medium' | 'high' | 'critical',
		estimate: ''
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

			const response = await fetch('/api/tickets', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});

			if (response.ok) {
				dispatch('created');
				dispatch('close');
			} else {
				const error = await response.json();
				console.error('Failed to create ticket:', error);
			}
		} catch (error) {
			console.error('Failed to create ticket:', error);
		} finally {
			isSubmitting = false;
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
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
	on:click={handleClose}
>
	<!-- Modal -->
	<div 
		class="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg mx-auto"
		on:click|stopPropagation
	>
		<!-- Header -->
		<div class="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
			<h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100">Create New Ticket</h2>
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
				<label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Type</label>
				<div class="flex gap-3">
					<button
						type="button"
						class="flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors {formData.type === 'task' 
							? 'border-blue-500 bg-blue-50 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300' 
							: 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500 text-gray-700 dark:text-gray-300'}"
						on:click={() => formData.type = 'task'}
					>
						<CheckSquare size={18} />
						<span class="font-medium">Task</span>
					</button>

					<button
						type="button"
						class="flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors {formData.type === 'bug' 
							? 'border-red-500 bg-red-50 dark:bg-red-900/50 text-red-700 dark:text-red-300' 
							: 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500 text-gray-700 dark:text-gray-300'}"
						on:click={() => formData.type = 'bug'}
					>
						<Bug size={18} />
						<span class="font-medium">Bug</span>
					</button>
				</div>
			</div>

			<!-- Title -->
			<div class="mb-4">
				<label for="title" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
					Title *
				</label>
				<input
					id="title"
					type="text"
					bind:value={formData.title}
					required
					class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
					placeholder="Enter ticket title..."
				>
			</div>

			<!-- Description -->
			<div class="mb-4">
				<label for="description" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
					Description
				</label>
				<textarea
					id="description"
					bind:value={formData.description}
					rows="3"
					class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
					placeholder="Enter ticket description..."
				></textarea>
			</div>

			<!-- Priority -->
			<div class="mb-4">
				<label for="priority" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
					Priority
				</label>
				<select
					id="priority"
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
				<label for="assignee" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
					Assignee
				</label>
				<select
					id="assignee"
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
				<label for="sprint" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
					Sprint
				</label>
				<select
					id="sprint"
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
				<label for="estimate" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
					Story Points
				</label>
				<input
					id="estimate"
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
					on:click={handleClose}
				>
					Cancel
				</button>
				<button
					type="submit"
					class="btn btn-primary"
					disabled={!formData.title.trim() || isSubmitting}
				>
					{#if isSubmitting}
						Creating...
					{:else}
						Create Ticket
					{/if}
				</button>
			</div>
		</form>
	</div>
</div>