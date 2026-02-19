<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import X from './icons/X.svelte';
	import User from './icons/User.svelte';
	import Calendar from './icons/Calendar.svelte';
	import Plus from './icons/Plus.svelte';
	import Trash from './icons/Trash.svelte';
	import { sprintStore, userStore } from './stores';

	const dispatch = createEventDispatcher();

	let activeTab = 'users';
	let newUser = { username: '', displayName: '', email: '' };
	let newSprint = { name: '', description: '', goal: '' };
	let isSubmitting = false;

	// Make newUser reactive
	$: canCreateUser = newUser.username.trim() && newUser.displayName.trim() && !isSubmitting;

	async function createUser() {
		console.log('createUser called', { newUser, canCreateUser });
		if (!newUser.username.trim() || !newUser.displayName.trim()) {
			console.log('Validation failed');
			return;
		}
		
		isSubmitting = true;
		try {
			console.log('Sending request to /api/users');
			const response = await fetch('/api/users', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(newUser)
			});

			console.log('Response:', { status: response.status, ok: response.ok });
			if (response.ok) {
				const result = await response.json();
				console.log('User created successfully:', result);
				newUser = { username: '', displayName: '', email: '' };
				dispatch('updated');
			} else {
				const errorText = await response.text();
				console.error('Failed to create user:', errorText);
			}
		} catch (error) {
			console.error('Failed to create user:', error);
		} finally {
			isSubmitting = false;
		}
	}

	async function createSprint() {
		if (!newSprint.name.trim()) return;
		
		isSubmitting = true;
		try {
			const response = await fetch('/api/sprints', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(newSprint)
			});

			if (response.ok) {
				newSprint = { name: '', description: '', goal: '' };
				dispatch('updated');
			}
		} catch (error) {
			console.error('Failed to create sprint:', error);
		} finally {
			isSubmitting = false;
		}
	}

	async function deleteUser(userId: string) {
		if (!confirm('Are you sure you want to delete this user?')) return;
		
		try {
			const response = await fetch(`/api/users/${userId}`, {
				method: 'DELETE'
			});

			if (response.ok) {
				dispatch('updated');
			}
		} catch (error) {
			console.error('Failed to delete user:', error);
		}
	}

	async function deleteSprint(sprintId: string) {
		if (!confirm('Are you sure you want to delete this sprint?')) return;
		
		try {
			const response = await fetch(`/api/sprints/${sprintId}`, {
				method: 'DELETE'
			});

			if (response.ok) {
				dispatch('updated');
			}
		} catch (error) {
			console.error('Failed to delete sprint:', error);
		}
	}

	async function updateSprintStatus(sprintId: string, newStatus: 'planning' | 'active' | 'completed') {
		try {
			const response = await fetch(`/api/sprints/${sprintId}/status`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: newStatus })
			});

			if (response.ok) {
				dispatch('updated');
			}
		} catch (error) {
			console.error('Failed to update sprint status:', error);
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
	on:click={handleClose}
>
	<!-- Modal -->
	<div 
		class="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl mx-auto max-h-[90vh] overflow-hidden"
		on:click|stopPropagation
	>
		<!-- Header -->
		<div class="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
			<h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100">Manage Users & Sprints</h2>
			<button 
				class="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
				on:click={handleClose}
			>
				<X size={24} />
			</button>
		</div>

		<!-- Tabs -->
		<div class="border-b border-gray-200 dark:border-gray-700">
			<nav class="flex">
				<button
					class="px-6 py-3 text-sm font-medium border-b-2 transition-colors {activeTab === 'users' 
						? 'border-blue-500 text-blue-600 dark:text-blue-400' 
						: 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}"
					on:click={() => activeTab = 'users'}
				>
					<div class="flex items-center gap-2">
						<User size={16} />
						Users
					</div>
				</button>
				<button
					class="px-6 py-3 text-sm font-medium border-b-2 transition-colors {activeTab === 'sprints' 
						? 'border-blue-500 text-blue-600 dark:text-blue-400' 
						: 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}"
					on:click={() => activeTab = 'sprints'}
				>
					<div class="flex items-center gap-2">
						<Calendar size={16} />
						Sprints
					</div>
				</button>
			</nav>
		</div>

		<!-- Content -->
		<div class="p-6 max-h-[60vh] overflow-y-auto">
			{#if activeTab === 'users'}
				<!-- Create User Form -->
				<div class="mb-6 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
					<h3 class="text-lg font-medium mb-4 flex items-center gap-2 text-gray-900 dark:text-gray-100">
						<Plus size={16} />
						Add New User
					</h3>
					<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
						<input
							type="text"
							placeholder="Username"
							bind:value={newUser.username}
							class="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
						>
						<input
							type="text"
							placeholder="Display Name"
							bind:value={newUser.displayName}
							class="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
						>
						<input
							type="email"
							placeholder="Email (optional)"
							bind:value={newUser.email}
							class="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
						>
					</div>
					<button
						type="button"
						class="btn btn-primary mt-4"
						disabled={!canCreateUser}
						on:click={createUser}
					>
						{isSubmitting ? 'Creating...' : 'Create User'}
					</button>
				</div>

				<!-- Users List -->
				<div class="space-y-2">
					<h3 class="text-lg font-medium mb-4 text-gray-900 dark:text-gray-100">Existing Users</h3>
					{#each $userStore as user}
						<div class="flex items-center justify-between p-3 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-lg">
							<div>
								<div class="font-medium text-gray-900 dark:text-gray-100">{user.displayName}</div>
								<div class="text-sm text-gray-500 dark:text-gray-400">@{user.username}</div>
								{#if user.email}
									<div class="text-sm text-gray-500 dark:text-gray-400">{user.email}</div>
								{/if}
							</div>
							<button
								class="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/50 rounded"
								on:click={() => deleteUser(user.id)}
							>
								<Trash size={16} />
							</button>
						</div>
					{:else}
							<p class="text-gray-500 dark:text-gray-400 italic">No users found</p>
					{/each}
				</div>

			{:else if activeTab === 'sprints'}
				<!-- Create Sprint Form -->
				<div class="mb-6 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
					<h3 class="text-lg font-medium mb-4 flex items-center gap-2 text-gray-900 dark:text-gray-100">
						<Plus size={16} />
						Add New Sprint
					</h3>
					<div class="space-y-4">
						<input
							type="text"
							placeholder="Sprint Name"
							bind:value={newSprint.name}
							class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
						>
						<textarea
							placeholder="Description"
							bind:value={newSprint.description}
							rows="3"
							class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
						></textarea>
						<input
							type="text"
							placeholder="Sprint Goal"
							bind:value={newSprint.goal}
							class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
						>
					</div>
					<button
						type="button"
						class="btn btn-primary mt-4"
						disabled={!newSprint.name.trim() || isSubmitting}
						on:click={createSprint}
					>
						{isSubmitting ? 'Creating...' : 'Create Sprint'}
					</button>
				</div>

				<!-- Sprints List -->
				<div class="space-y-2">
					<h3 class="text-lg font-medium mb-4 text-gray-900 dark:text-gray-100">Existing Sprints</h3>
					{#each $sprintStore as sprint}
						<div class="flex items-center justify-between p-3 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-lg">
							<div class="flex-1">
								<div class="font-medium text-gray-900 dark:text-gray-100">{sprint.name}</div>
							<div class="text-sm text-gray-500 dark:text-gray-400 capitalize flex items-center gap-2">
								Status: 
								<span class="{sprint.status === 'completed' ? 'text-green-600' : sprint.status === 'active' ? 'text-blue-600' : 'text-yellow-600'}">
									{sprint.status}
								</span>
							</div>
							{#if sprint.description}
								<div class="text-sm text-gray-600 dark:text-gray-300 mt-1">{sprint.description}</div>
							{/if}
							{#if sprint.goal}
								<div class="text-sm text-blue-600 dark:text-blue-400 mt-1">Goal: {sprint.goal}</div>
							{/if}
						</div>
						<div class="flex items-center gap-2">
							{#if sprint.status === 'planning'}
								<button
									class="btn text-sm px-3 py-1.5 bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
									on:click={() => updateSprintStatus(sprint.id, 'active')}
									title="Start Sprint"
								>
									Start
								</button>
							{:else if sprint.status === 'active'}
								<button
									class="btn text-sm px-3 py-1.5 bg-green-600 text-white hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600"
									on:click={() => updateSprintStatus(sprint.id, 'completed')}
									title="Complete Sprint"
								>
									Complete
								</button>
							{:else if sprint.status === 'completed'}
								<button
									class="btn text-sm px-3 py-1.5 bg-yellow-600 text-white hover:bg-yellow-700 dark:bg-yellow-500 dark:hover:bg-yellow-600"
									on:click={() => updateSprintStatus(sprint.id, 'active')}
									title="Reopen Sprint"
								>
									Reopen
								</button>
							{/if}
							<button
									class="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/50 rounded"
								on:click={() => deleteSprint(sprint.id)}
								title="Delete Sprint"
							>
								<Trash size={16} />
							</button>
						</div>
						</div>
					{:else}
							<p class="text-gray-500 dark:text-gray-400 italic">No sprints found</p>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Footer -->
		<div class="flex justify-end p-6 border-t border-gray-200 dark:border-gray-700">
			<button
				class="btn btn-secondary"
				on:click={() => dispatch('close')}
			>
				Close
			</button>
		</div>
	</div>
</div>