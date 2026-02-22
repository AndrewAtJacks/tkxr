<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import X from './icons/X.svelte';
	import Calendar from './icons/Calendar.svelte';
	import Plus from './icons/Plus.svelte';
	import Trash from './icons/Trash.svelte';
	import Edit from './icons/Edit.svelte';
	import ChevronDown from './icons/ChevronDown.svelte';
	import { sprintStore } from './stores';

	const dispatch = createEventDispatcher();

	// Accordion state - active is expanded by default
	let expandedSections = { planning: false, active: true, completed: false };

	let newSprint = { name: '', description: '', goal: '' };
	let editingSprint: any = null;
	let isSubmitting = false;

	// Form values
	let formName = '';
	let formDescription = '';
	let formGoal = '';

	// Group sprints by status
	$: planningSprints = $sprintStore.filter(s => s.status === 'planning');
	$: activeSprints = $sprintStore.filter(s => s.status === 'active');
	$: completedSprints = $sprintStore.filter(s => s.status === 'completed');

	$: canSubmit = formName.trim() && !isSubmitting;

	async function createSprint() {
		if (!formName.trim()) return;
		
		isSubmitting = true;
		try {
			const response = await fetch('/api/sprints', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: formName,
					description: formDescription,
					goal: formGoal
				})
			});

			if (response.ok) {
				formName = '';
				formDescription = '';
				formGoal = '';
				dispatch('updated');
			} else {
				console.error('Failed to create sprint:', await response.text());
			}
		} catch (error) {
			console.error('Failed to create sprint:', error);
		} finally {
			isSubmitting = false;
		}
	}

	async function updateSprint() {
		if (!editingSprint || !formName.trim()) return;
		
		isSubmitting = true;
		try {
			const response = await fetch(`/api/sprints/${editingSprint.id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: formName,
					description: formDescription,
					goal: formGoal
				})
			});

			if (response.ok) {
				editingSprint = null;
				formName = '';
				formDescription = '';
				formGoal = '';
				dispatch('updated');
			} else {
				console.error('Failed to update sprint:', await response.text());
			}
		} catch (error) {
			console.error('Failed to update sprint:', error);
		} finally {
			isSubmitting = false;
		}
	}

	async function deleteSprint(id: string) {
		if (!confirm('Are you sure you want to delete this sprint?')) return;
		
		try {
			const response = await fetch(`/api/sprints/${id}`, {
				method: 'DELETE'
			});

			if (response.ok) {
				dispatch('updated');
			} else {
				console.error('Failed to delete sprint:', await response.text());
			}
		} catch (error) {
			console.error('Failed to delete sprint:', error);
		}
	}

	async function updateSprintStatus(id: string, status: string) {
		try {
			const response = await fetch(`/api/sprints/${id}/status`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status })
			});

			if (response.ok) {
				dispatch('updated');
			} else {
				console.error('Failed to update sprint status:', await response.text());
			}
		} catch (error) {
			console.error('Failed to update sprint status:', error);
		}
	}

	function startEditing(sprint: any) {
		editingSprint = { ...sprint };
		formName = sprint.name;
		formDescription = sprint.description || '';
		formGoal = sprint.goal || '';
	}

	function cancelEditing() {
		editingSprint = null;
		formName = '';
		formDescription = '';
		formGoal = '';
	}

	function toggleSection(section: 'planning' | 'active' | 'completed') {
		expandedSections[section] = !expandedSections[section];
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (editingSprint) {
				cancelEditing();
			} else {
				dispatch('close');
			}
		}
	}

	function handleClose() {
		dispatch('close');
	}

	function handleSubmit(e: Event) {
		e.preventDefault();
		if (editingSprint) {
			updateSprint();
		} else {
			createSprint();
		}
	}
</script>

<svelte:window on:keydown={handleKeydown} />

<!-- Backdrop -->
<div 
	class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
	on:click={(e) => { if (e.target === e.currentTarget) handleClose(); }}
	role="dialog"
	aria-modal="true"
>
	<!-- Modal -->
	<section
		class="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl mx-auto max-h-[90vh] overflow-hidden"
		role="dialog"
		aria-modal="true"
	>
		<!-- Header -->
		<div class="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
			<h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
				<Calendar size={24} />
				Sprint Management
			</h2>
			<button 
				class="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
				on:click={handleClose}
				aria-label="Close"
			>
				<X size={24} />
			</button>
		</div>

		<!-- Content -->
		<div class="p-6 max-h-[calc(90vh-180px)] overflow-y-auto">
			<!-- Create/Edit Sprint Form -->
			<form on:submit={handleSubmit} class="mb-6 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
				<h3 class="text-lg font-medium mb-4 flex items-center gap-2 text-gray-900 dark:text-gray-100">
					{#if editingSprint}
						<Edit size={16} />
						Edit Sprint
					{:else}
						<Plus size={16} />
						Create New Sprint
					{/if}
				</h3>
				<div class="space-y-4">
					<div>
						<label for="sprint-name" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
							Sprint Name <span class="text-red-500">*</span>
						</label>
						<input
							id="sprint-name"
							type="text"
							placeholder="Sprint Name"
							bind:value={formName}
							required
							class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
						>
					</div>
					<div>
						<label for="sprint-description" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
							Description
						</label>
						<textarea
							id="sprint-description"
							placeholder="Description"
						bind:value={formDescription}
							rows="3"
							class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
						></textarea>
					</div>
					<div>
						<label for="sprint-goal" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
							Sprint Goal
						</label>
						<input
							id="sprint-goal"
							type="text"
							placeholder="Sprint Goal"
							bind:value={formGoal}
							class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
						>
					</div>
				</div>
				<div class="flex gap-2 mt-4">
					<button
						type="submit"
						class="btn btn-primary"
						disabled={!canSubmit}
					>
						{#if isSubmitting}
							{editingSprint ? 'Updating...' : 'Creating...'}
						{:else}
							{editingSprint ? 'Update Sprint' : 'Create Sprint'}
						{/if}
					</button>
					{#if editingSprint}
						<button
							type="button"
							class="btn btn-secondary"
							on:click={cancelEditing}
						>
							Cancel
						</button>
					{/if}
				</div>
			</form>

			<!-- Sprints Accordion -->
			<div class="space-y-2">
				<h3 class="text-lg font-medium mb-4 text-gray-900 dark:text-gray-100">Existing Sprints</h3>
				
				{#if $sprintStore.length === 0}
					<p class="text-gray-500 dark:text-gray-400 italic text-center py-8">No sprints found. Create your first sprint above.</p>
				{:else}
					<!-- Planning Sprints Accordion -->
					<div class="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
						<button
							class="w-full flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-650 transition-colors"
							on:click={() => toggleSection('planning')}
						>
							<div class="flex items-center gap-2">
								<span class="font-medium text-gray-900 dark:text-gray-100">Planning</span>
								<span class="text-sm text-gray-500 dark:text-gray-400">({planningSprints.length})</span>
							</div>
							<div class="transform transition-transform {expandedSections.planning ? 'rotate-180' : ''}">
								<ChevronDown size={20} />
							</div>
						</button>
						{#if expandedSections.planning}
							<div class="p-2 space-y-2 bg-white dark:bg-gray-800">
								{#each planningSprints as sprint}
									<div class="flex items-start justify-between p-4 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-lg gap-4">
										<div class="flex-1 min-w-0">
											<div class="font-medium text-gray-900 dark:text-gray-100">{sprint.name}</div>
											{#if sprint.description}
												<div class="text-sm text-gray-600 dark:text-gray-300 mt-2">{sprint.description}</div>
											{/if}
											{#if sprint.goal}
												<div class="text-sm text-blue-600 dark:text-blue-400 mt-1">Goal: {sprint.goal}</div>
											{/if}
										</div>
										<div class="flex items-center gap-2 flex-shrink-0">
										<!-- Status Button Group -->
										<div class="inline-flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden" role="group" aria-label="Update sprint status">
											<button
												class="px-3 py-1.5 text-xs font-medium transition-colors
													{sprint.status === 'planning'
														? 'bg-gray-200 text-gray-900 dark:bg-gray-600 dark:text-gray-100'
														: 'bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'}
													border-r border-gray-300 dark:border-gray-600"
												title="Set to Planning"
												aria-pressed={sprint.status === 'planning'}
												on:click={() => updateSprintStatus(sprint.id, 'planning')}
											>
												Planning
											</button>
											<button
												class="px-3 py-1.5 text-xs font-medium transition-colors
													{sprint.status === 'active'
														? 'bg-blue-200 text-blue-900 dark:bg-blue-700 dark:text-blue-100'
														: 'bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'}
													border-r border-gray-300 dark:border-gray-600"
												title="Set to Active"
												aria-pressed={sprint.status === 'active'}
												on:click={() => updateSprintStatus(sprint.id, 'active')}
											>
												Active
											</button>
											<button
												class="px-3 py-1.5 text-xs font-medium transition-colors
													{sprint.status === 'completed'
														? 'bg-green-200 text-green-900 dark:bg-green-700 dark:text-green-100'
														: 'bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'}"
												title="Set to Completed"
												aria-pressed={sprint.status === 'completed'}
												on:click={() => updateSprintStatus(sprint.id, 'completed')}
											>
												Completed
											</button>
										</div>
											<button
												class="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/50 rounded"
												on:click={() => startEditing(sprint)}
												title="Edit Sprint"
												aria-label="Edit sprint"
											>
												<Edit size={16} />
											</button>
											<button
												class="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/50 rounded"
												on:click={() => deleteSprint(sprint.id)}
												title="Delete Sprint"
												aria-label="Delete sprint"
											>
												<Trash size={16} />
											</button>
										</div>
									</div>
								{:else}
									<p class="text-gray-500 dark:text-gray-400 text-sm italic text-center py-4">No sprints in planning</p>
								{/each}
							</div>
						{/if}
					</div>

					<!-- Active Sprints Accordion -->
					<div class="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
						<button
							class="w-full flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-650 transition-colors"
							on:click={() => toggleSection('active')}
						>
							<div class="flex items-center gap-2">
								<span class="font-medium text-gray-900 dark:text-gray-100">Active</span>
								<span class="text-sm text-gray-500 dark:text-gray-400">({activeSprints.length})</span>
							</div>
							<div class="transform transition-transform {expandedSections.active ? 'rotate-180' : ''}">
								<ChevronDown size={20} />
							</div>
						</button>
						{#if expandedSections.active}
							<div class="p-2 space-y-2 bg-white dark:bg-gray-800">
								{#each activeSprints as sprint}
									<div class="flex items-start justify-between p-4 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-lg gap-4">
										<div class="flex-1 min-w-0">
											<div class="font-medium text-gray-900 dark:text-gray-100">{sprint.name}</div>
											{#if sprint.description}
												<div class="text-sm text-gray-600 dark:text-gray-300 mt-2">{sprint.description}</div>
											{/if}
											{#if sprint.goal}
												<div class="text-sm text-blue-600 dark:text-blue-400 mt-1">Goal: {sprint.goal}</div>
											{/if}
										</div>
										<div class="flex items-center gap-2 flex-shrink-0">
										<!-- Status Button Group -->
										<div class="inline-flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden" role="group" aria-label="Update sprint status">
											<button
												class="px-3 py-1.5 text-xs font-medium transition-colors
													{sprint.status === 'planning'
														? 'bg-gray-200 text-gray-900 dark:bg-gray-600 dark:text-gray-100'
														: 'bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'}
													border-r border-gray-300 dark:border-gray-600"
												title="Set to Planning"
												aria-pressed={sprint.status === 'planning'}
												on:click={() => updateSprintStatus(sprint.id, 'planning')}
											>
												Planning
											</button>
											<button
												class="px-3 py-1.5 text-xs font-medium transition-colors
													{sprint.status === 'active'
														? 'bg-blue-200 text-blue-900 dark:bg-blue-700 dark:text-blue-100'
														: 'bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'}
													border-r border-gray-300 dark:border-gray-600"
												title="Set to Active"
												aria-pressed={sprint.status === 'active'}
												on:click={() => updateSprintStatus(sprint.id, 'active')}
											>
												Active
											</button>
											<button
												class="px-3 py-1.5 text-xs font-medium transition-colors
													{sprint.status === 'completed'
														? 'bg-green-200 text-green-900 dark:bg-green-700 dark:text-green-100'
														: 'bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'}"
												title="Set to Completed"
												aria-pressed={sprint.status === 'completed'}
												on:click={() => updateSprintStatus(sprint.id, 'completed')}
											>
												Completed
											</button>
										</div>
											<button
												class="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/50 rounded"
												on:click={() => startEditing(sprint)}
												title="Edit Sprint"
												aria-label="Edit sprint"
											>
												<Edit size={16} />
											</button>
											<button
												class="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/50 rounded"
												on:click={() => deleteSprint(sprint.id)}
												title="Delete Sprint"
												aria-label="Delete sprint"
											>
												<Trash size={16} />
											</button>
										</div>
									</div>
								{:else}
									<p class="text-gray-500 dark:text-gray-400 text-sm italic text-center py-4">No active sprints</p>
								{/each}
							</div>
						{/if}
					</div>

					<!-- Completed Sprints Accordion -->
					<div class="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
						<button
							class="w-full flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-650 transition-colors"
							on:click={() => toggleSection('completed')}
						>
							<div class="flex items-center gap-2">
								<span class="font-medium text-gray-900 dark:text-gray-100">Completed</span>
								<span class="text-sm text-gray-500 dark:text-gray-400">({completedSprints.length})</span>
							</div>
							<div class="transform transition-transform {expandedSections.completed ? 'rotate-180' : ''}">
								<ChevronDown size={20} />
							</div>
						</button>
						{#if expandedSections.completed}
							<div class="p-2 space-y-2 bg-white dark:bg-gray-800">
								{#each completedSprints as sprint}
									<div class="flex items-start justify-between p-4 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-lg gap-4">
										<div class="flex-1 min-w-0">
											<div class="font-medium text-gray-900 dark:text-gray-100">{sprint.name}</div>
											{#if sprint.description}
												<div class="text-sm text-gray-600 dark:text-gray-300 mt-2">{sprint.description}</div>
											{/if}
											{#if sprint.goal}
												<div class="text-sm text-blue-600 dark:text-blue-400 mt-1">Goal: {sprint.goal}</div>
											{/if}
										</div>
										<div class="flex items-center gap-2 flex-shrink-0">
										<!-- Status Button Group -->
										<div class="inline-flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden" role="group" aria-label="Update sprint status">
											<button
												class="px-3 py-1.5 text-xs font-medium transition-colors
													{sprint.status === 'planning'
														? 'bg-gray-200 text-gray-900 dark:bg-gray-600 dark:text-gray-100'
														: 'bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'}
													border-r border-gray-300 dark:border-gray-600"
												title="Set to Planning"
												aria-pressed={sprint.status === 'planning'}
												on:click={() => updateSprintStatus(sprint.id, 'planning')}
											>
												Planning
											</button>
											<button
												class="px-3 py-1.5 text-xs font-medium transition-colors
													{sprint.status === 'active'
														? 'bg-blue-200 text-blue-900 dark:bg-blue-700 dark:text-blue-100'
														: 'bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'}
													border-r border-gray-300 dark:border-gray-600"
												title="Set to Active"
												aria-pressed={sprint.status === 'active'}
												on:click={() => updateSprintStatus(sprint.id, 'active')}
											>
												Active
											</button>
											<button
												class="px-3 py-1.5 text-xs font-medium transition-colors
													{sprint.status === 'completed'
														? 'bg-green-200 text-green-900 dark:bg-green-700 dark:text-green-100'
														: 'bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'}"
												title="Set to Completed"
												aria-pressed={sprint.status === 'completed'}
												on:click={() => updateSprintStatus(sprint.id, 'completed')}
											>
												Completed
											</button>
										</div>
											<button
												class="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/50 rounded"
												on:click={() => startEditing(sprint)}
												title="Edit Sprint"
												aria-label="Edit sprint"
											>
												<Edit size={16} />
											</button>
											<button
												class="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/50 rounded"
												on:click={() => deleteSprint(sprint.id)}
												title="Delete Sprint"
												aria-label="Delete sprint"
											>
												<Trash size={16} />
											</button>
										</div>
									</div>
								{:else}
									<p class="text-gray-500 dark:text-gray-400 text-sm italic text-center py-4">No completed sprints</p>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</div>

		<!-- Footer -->
		<div class="flex justify-end p-6 border-t border-gray-200 dark:border-gray-700">
			<button
				class="btn btn-secondary"
				on:click={handleClose}
			>
				Close
			</button>
		</div>
	</section>
</div>
