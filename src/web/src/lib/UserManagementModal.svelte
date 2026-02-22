<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import X from './icons/X.svelte';
	import User from './icons/User.svelte';
	import Plus from './icons/Plus.svelte';
	import Trash from './icons/Trash.svelte';
	import Edit from './icons/Edit.svelte';
	import { userStore } from './stores';

	const dispatch = createEventDispatcher();

	let newUser = { username: '', displayName: '', email: '' };
	let editingUser: any = null;
	let isSubmitting = false;

	// Form values
	let formUsername = '';
	let formDisplayName = '';
	let formEmail = '';

	$: canSubmit = formUsername.trim() && formDisplayName.trim() && !isSubmitting;

	async function createUser() {
		if (!formUsername.trim() || !formDisplayName.trim()) return;
		
		isSubmitting = true;
		try {
			const response = await fetch('/api/users', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					username: formUsername,
					displayName: formDisplayName,
					email: formEmail
				})
			});

			if (response.ok) {
				formUsername = '';
				formDisplayName = '';
				formEmail = '';
				dispatch('updated');
			} else {
				console.error('Failed to create user:', await response.text());
			}
		} catch (error) {
			console.error('Failed to create user:', error);
		} finally {
			isSubmitting = false;
		}
	}

	async function updateUser() {
		if (!editingUser || !formUsername.trim() || !formDisplayName.trim()) return;
		
		isSubmitting = true;
		try {
			const response = await fetch(`/api/users/${editingUser.id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					username: formUsername,
					displayName: formDisplayName,
					email: formEmail
				})
			});

			if (response.ok) {
				editingUser = null;
				formUsername = '';
				formDisplayName = '';
				formEmail = '';
				dispatch('updated');
			} else {
				console.error('Failed to update user:', await response.text());
			}
		} catch (error) {
			console.error('Failed to update user:', error);
		} finally {
			isSubmitting = false;
		}
	}

	async function deleteUser(id: string) {
		if (!confirm('Are you sure you want to delete this user?')) return;
		
		try {
			const response = await fetch(`/api/users/${id}`, {
				method: 'DELETE'
			});

			if (response.ok) {
				dispatch('updated');
			} else {
				console.error('Failed to delete user:', await response.text());
			}
		} catch (error) {
			console.error('Failed to delete user:', error);
		}
	}

	function startEditing(user: any) {
		editingUser = { ...user };
		formUsername = user.username;
		formDisplayName = user.displayName;
		formEmail = user.email || '';
	}

	function cancelEditing() {
		editingUser = null;
		formUsername = '';
		formDisplayName = '';
		formEmail = '';
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (editingUser) {
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
		if (editingUser) {
			updateUser();
		} else {
			createUser();
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
				<User size={24} />
				User Management
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
			<!-- Create/Edit User Form -->
			<form on:submit={handleSubmit} class="mb-6 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
				<h3 class="text-lg font-medium mb-4 flex items-center gap-2 text-gray-900 dark:text-gray-100">
					{#if editingUser}
						<Edit size={16} />
						Edit User
					{:else}
						<Plus size={16} />
						Create New User
					{/if}
				</h3>
				<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
					<div>
						<label for="username" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
							Username <span class="text-red-500">*</span>
						</label>
						<input
							id="username"
							type="text"
							placeholder="Username"
							bind:value={formUsername}
							required
							class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
						>
					</div>
					<div>
						<label for="display-name" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
							Display Name <span class="text-red-500">*</span>
						</label>
						<input
							id="display-name"
							type="text"
							placeholder="Display Name"
							bind:value={formDisplayName}
							required
							class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
						>
					</div>
					<div>
						<label for="email" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
							Email
						</label>
						<input
							id="email"
							type="email"
							placeholder="Email (optional)"
							bind:value={formEmail}
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
							{editingUser ? 'Updating...' : 'Creating...'}
						{:else}
							{editingUser ? 'Update User' : 'Create User'}
						{/if}
					</button>
					{#if editingUser}
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

			<!-- Users Table -->
			<div class="space-y-2">
				<h3 class="text-lg font-medium mb-4 text-gray-900 dark:text-gray-100">Existing Users</h3>
				{#each $userStore as user}
					<div class="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-lg">
						<div class="flex-1 min-w-0">
							<div class="font-medium text-gray-900 dark:text-gray-100">{user.displayName}</div>
							<div class="text-sm text-gray-500 dark:text-gray-400">@{user.username}</div>
							{#if user.email}
								<div class="text-sm text-gray-500 dark:text-gray-400">{user.email}</div>
							{/if}
						</div>
						<div class="flex items-center gap-2 flex-shrink-0">
							<button
								class="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/50 rounded"
								on:click={() => startEditing(user)}
								title="Edit User"
								aria-label="Edit user"
							>
								<Edit size={16} />
							</button>
							<button
								class="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/50 rounded"
								on:click={() => deleteUser(user.id)}
								title="Delete User"
								aria-label="Delete user"
							>
								<Trash size={16} />
							</button>
						</div>
					</div>
				{:else}
					<p class="text-gray-500 dark:text-gray-400 italic text-center py-8">No users found. Create your first user above.</p>
				{/each}
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
