<script lang="ts">
	import { onMount } from 'svelte';
	import Plus from '../lib/icons/Plus.svelte';
	import Bug from '../lib/icons/Bug.svelte';
	import CheckSquare from '../lib/icons/CheckSquare.svelte';
	import Clock from '../lib/icons/Clock.svelte';
	import Done from '../lib/icons/Check.svelte';
	import Grid from '../lib/icons/Grid.svelte';
	import Columns from '../lib/icons/Columns.svelte';
	import Menu from '../lib/icons/Menu.svelte';
	import X from '../lib/icons/X.svelte';
	import TicketCard from '../lib/TicketCard.svelte';
	import KanbanBoard from '../lib/KanbanBoard.svelte';
	import CreateTicketModal from '../lib/CreateTicketModal.svelte';
	import ManageModal from '../lib/ManageModal.svelte';
	import EditTicketModal from '../lib/EditTicketModal.svelte';
	import CommentsModal from '../lib/CommentsModal.svelte';
	import DarkModeToggle from '../lib/DarkModeToggle.svelte';
	import { ticketStore, sprintStore, userStore } from '../lib/stores';

	let showCreateModal = false;
	let showManageModal = false;
	let showEditModal = false;
	let showCommentsModal = false;
	let editingTicket = null;
	let commentsTicket = null;
	let activeTab = 'all-open';
	let selectedSprint = 'all'; // all, no-sprint, or sprint ID
	let searchTerm = '';
	let sortBy = 'updated'; // updated, created, title, priority, status
	let sortOrder = 'desc'; // asc, desc
	let viewMode = 'grid'; // 'grid' or 'kanban'
	let createModalDefaultStatus: 'todo' | 'progress' | 'done' | null = null;
	let showDrawer = false;
	let settingsLoaded = false; // Flag to prevent saving during initial load

	// UI Settings persistence key
	const UI_SETTINGS_KEY = 'tkxr-ui-settings';

	// Load initial UI settings immediately (not in onMount)
	if (typeof window !== 'undefined') {
		try {
			const saved = localStorage.getItem(UI_SETTINGS_KEY);
			if (saved) {
				const settings = JSON.parse(saved);
				activeTab = settings.activeTab || 'all-open';
				selectedSprint = settings.selectedSprint || 'all';
				searchTerm = settings.searchTerm || '';
				sortBy = settings.sortBy || 'updated';
				sortOrder = settings.sortOrder || 'desc';
				viewMode = settings.viewMode || 'grid';
			}
		} catch (error) {
			console.warn('Failed to load UI settings:', error);
		}
	}

	// Load persisted UI settings (now only used for enabling save functionality)
	function enableSettingsPersistence() {
		settingsLoaded = true; // Enable saving after initial load
	}

	// Save UI settings to localStorage
	function saveUISettings() {
		if (typeof window === 'undefined') return; // SSR check
		
		try {
			const settings = {
				activeTab,
				selectedSprint,
				searchTerm,
				sortBy,
				sortOrder,
				viewMode,
				lastUpdated: Date.now()
			};
			localStorage.setItem(UI_SETTINGS_KEY, JSON.stringify(settings));
		} catch (error) {
			console.warn('Failed to save UI settings:', error);
		}
	}

	// Reset UI settings to defaults
	function resetUISettings() {
		if (typeof window === 'undefined') return; // SSR check
		
		try {
			localStorage.removeItem(UI_SETTINGS_KEY);
			// Reset to default values
			activeTab = 'all-open';
			selectedSprint = 'all';
			searchTerm = '';
			sortBy = 'updated';
			sortOrder = 'desc';
			viewMode = 'grid';
		} catch (error) {
			console.warn('Failed to reset UI settings:', error);
		}
	}

	// Reactive statements to save settings when they change (but not during initial load)
	$: if (settingsLoaded && typeof window !== 'undefined' && (activeTab, selectedSprint, searchTerm, sortBy, sortOrder, viewMode, true)) {
		saveUISettings();
	}
	
	onMount(() => {
		enableSettingsPersistence(); // Enable settings saving after component mounts
		loadData();
		setupWebSocket();
	});

	async function loadData() {
		try {
			// Load all data concurrently
			const [ticketsRes, sprintsRes, usersRes] = await Promise.all([
				fetch('/api/tickets'),
				fetch('/api/sprints'),
				fetch('/api/users')
			]);

			if (ticketsRes.ok) {
				const tickets = await ticketsRes.json();
				ticketStore.set(tickets);
			}

			if (sprintsRes.ok) {
				const sprints = await sprintsRes.json();
				sprintStore.set(sprints);
			}

			if (usersRes.ok) {
				const users = await usersRes.json();
				userStore.set(users);
			}
		} catch (error) {
			console.error('Failed to load data:', error);
		}
	}

	function setupWebSocket() {
		const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
		
		ws.onmessage = (event) => {
			const message = JSON.parse(event.data);
			
			if (message.type === 'ticket_created' || 
				message.type === 'ticket_updated' || 
				message.type === 'ticket_deleted' ||
				message.type === 'sprint_created' ||
				message.type === 'sprint_updated' ||
				message.type === 'user_created') {
				loadData(); // Simple refresh for now
			}
		};
		
		ws.onopen = () => {
			console.debug('WebSocket connected');
		};
		
		ws.onclose = () => {
			console.debug('WebSocket disconnected');
		};
	}

	function handleEditTicket(ticket) {
		editingTicket = ticket;
		showEditModal = true;
	}

	function handleCommentsTicket(ticket) {
		commentsTicket = ticket;
		showCommentsModal = true;
	}

	$: filteredTickets = $ticketStore
		.filter(ticket => {
			// Sprint filter
			if (selectedSprint === 'no-sprint' && ticket.sprint) return false;
			if (selectedSprint !== 'all' && selectedSprint !== 'no-sprint' && ticket.sprint !== selectedSprint) return false;
			
			// Search filter
			if (searchTerm) {
				const term = searchTerm.toLowerCase();
				const searchableText = `${ticket.title} ${ticket.description || ''} ${ticket.id}`.toLowerCase();
				if (!searchableText.includes(term)) return false;
			}
			
			// Tab filter (only applied in grid view)
			if (viewMode === 'grid') {
				if (activeTab === 'all-open') return ticket.status !== 'done';
				if (activeTab === 'open-tasks') return ticket.type === 'task' && ticket.status !== 'done';
				if (activeTab === 'open-bugs') return ticket.type === 'bug' && ticket.status !== 'done';
				if (activeTab === 'todo') return ticket.status === 'todo';
				if (activeTab === 'progress') return ticket.status === 'progress';
				if (activeTab === 'done') return ticket.status === 'done';
				if (activeTab === 'all') return true;
			}
			
			// Kanban view shows all tickets (no tab filter)
			return true;
		})
		.sort((a, b) => {
			let compareValue = 0;
			
			switch (sortBy) {
				case 'title':
					compareValue = a.title.localeCompare(b.title);
					break;
				case 'status':
					const statusOrder = { todo: 0, progress: 1, done: 2 };
					compareValue = statusOrder[a.status] - statusOrder[b.status];
					break;
				case 'priority':
					const priorityOrder = { low: 0, medium: 1, high: 2, critical: 3 };
					const aPriorityValue = priorityOrder[a.priority] ?? 1;
					const bPriorityValue = priorityOrder[b.priority] ?? 1;
					compareValue = aPriorityValue - bPriorityValue; // Low to high (ascending base)
					
					// If priorities are equal, sort bugs before tasks
					if (compareValue === 0) {
						if (a.type === 'bug' && b.type === 'task') {
							compareValue = -1; // bug comes first
						} else if (a.type === 'task' && b.type === 'bug') {
							compareValue = 1; // task comes second
						}
					}
					break;
				case 'created':
					compareValue = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
					break;
				case 'updated':
				default:
					compareValue = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
					break;
			}
			
			return sortOrder === 'desc' ? -compareValue : compareValue;
		});

	// Calculate stats based on filtered tickets by sprint
	$: sprintFilteredTickets = $ticketStore.filter(ticket => {
		if (selectedSprint === 'no-sprint' && ticket.sprint) return false;
		if (selectedSprint !== 'all' && selectedSprint !== 'no-sprint' && ticket.sprint !== selectedSprint) return false;
		return true;
	});

	// Calculate sprint progress based on story points
	$: sprintProgress = (() => {
		// Only calculate for specific sprint selection
		if (selectedSprint === 'all' || selectedSprint === 'no-sprint') {
			return { totalPoints: 0, completedPoints: 0, percentage: 0, isVisible: false };
		}

		const sprintTickets = $ticketStore.filter(ticket => ticket.sprint === selectedSprint);
		const totalPoints = sprintTickets.reduce((sum, ticket) => sum + (ticket.estimate || 0), 0);
		const completedPoints = sprintTickets
			.filter(ticket => ticket.status === 'done')
			.reduce((sum, ticket) => sum + (ticket.estimate || 0), 0);
		
		const percentage = totalPoints > 0 ? Math.round((completedPoints / totalPoints) * 100) : 0;
		
		return {
			totalPoints,
			completedPoints,
			percentage,
			isVisible: true,
			sprintName: $sprintStore.find(s => s.id === selectedSprint)?.name || 'Unknown Sprint'
		};
	})();
</script>

<svelte:head>
	<title>tkxr - Dashboard</title>
</svelte:head>

<div class="container mx-auto px-4 py-8">
	<!-- Header -->
	<header class="mb-8">
		<div class="flex items-center justify-between">
			<div>
				<h1 class="text-3xl font-bold text-gray-900 dark:text-gray-100">tkxr</h1>
				<div class="flex items-center gap-2">
					<p class="text-gray-600 dark:text-gray-400">In-repo ticket management</p>
					<span class="text-xs text-gray-500 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">v1.0.0</span>
				</div>
			</div>
			<div class="flex items-center gap-4">
				<DarkModeToggle />
				
				<!-- View Toggle -->
				<div class="relative">
					<div class="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
						<button 
							class="view-toggle-btn {viewMode === 'grid' ? 'active' : ''}"
							on:click={() => viewMode = 'grid'}
							title="Grid View"
						>
							<Grid size={16} />
							<span class="hidden sm:inline">Grid</span>
						</button>
						<button 
							class="view-toggle-btn {viewMode === 'kanban' ? 'active' : ''}"  
							on:click={() => viewMode = 'kanban'}
							title="Kanban Board"
						>
							<Columns size={16} />
							<span class="hidden sm:inline">Board</span>
						</button>
					</div>
				</div>
				
				<!-- Hamburger Menu Button -->
				<div class="relative">
					<button 
						class="btn btn-secondary flex items-center gap-2"
						on:click={() => showDrawer = true}
						title="Search and Filters"
					>
						<Menu size={20} />
						<span class="hidden sm:inline">Options</span>
					</button>
					
					<!-- Search Active Badge -->
					{#if searchTerm}
						<div class="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full border-2 border-white dark:border-gray-800"></div>
					{/if}
				</div>
			</div>
		</div>

		<!-- Sprint Progress Bar -->
		{#if sprintProgress.isVisible}
			<div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-600 p-4 shadow-sm mb-4">
				<div class="flex items-center justify-between mb-2">
					<h3 class="text-sm font-medium text-gray-900 dark:text-gray-100">
						{sprintProgress.sprintName} Progress
					</h3>
					<span class="text-sm font-medium text-gray-600 dark:text-gray-400">
						{sprintProgress.completedPoints} / {sprintProgress.totalPoints} points ({sprintProgress.percentage}%)
					</span>
				</div>
				<div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
					<div 
						class="h-3 rounded-full transition-all duration-500 ease-out"
						class:bg-gray-300={sprintProgress.percentage === 0}
						class:bg-red-500={sprintProgress.percentage > 0 && sprintProgress.percentage <= 25}
						class:bg-yellow-500={sprintProgress.percentage > 25 && sprintProgress.percentage <= 75}
						class:bg-green-500={sprintProgress.percentage > 75}
						style="width: {sprintProgress.percentage}%"
					></div>
				</div>
			</div>
		{/if}
	</header>

	<!-- Stats -->
	<div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
		<button 
			class="card hover:shadow-lg transition-shadow cursor-pointer text-left w-full"
			on:click={() => activeTab = 'all'}
			title="View all tickets"
		>
			<div class="flex items-center gap-3">
				<div class="p-2 bg-blue-100 dark:bg-blue-800 rounded-lg">
					<CheckSquare class="w-6 h-6 text-blue-600 dark:text-blue-300" />
				</div>
				<div>
					<p class="text-2xl font-bold">{sprintFilteredTickets.length}</p>
					<p class="text-gray-600 dark:text-gray-400">Total Tickets</p>
				</div>
			</div>
		</button>

		<button 
			class="card hover:shadow-lg transition-shadow cursor-pointer text-left w-full"
			on:click={() => activeTab = 'open-bugs'}
			title="View open bugs"
		>
			<div class="flex items-center gap-3">
				<div class="p-2 bg-red-100 dark:bg-red-800 rounded-lg">
					<Bug class="w-6 h-6 text-red-600 dark:text-red-300" />
				</div>
				<div>
					<p class="text-2xl font-bold">{sprintFilteredTickets.filter(t => t.type === 'bug' && t.status !== 'done').length}</p>
					<p class="text-gray-600 dark:text-gray-400">Open Bugs</p>
				</div>
			</div>
		</button>

		<button 
			class="card hover:shadow-lg transition-shadow cursor-pointer text-left w-full"
			on:click={() => activeTab = 'progress'}
			title="View tickets in progress"
		>
			<div class="flex items-center gap-3">
				<div class="p-2 bg-yellow-100 dark:bg-yellow-800 rounded-lg">
					<Clock class="w-6 h-6 text-yellow-600 dark:text-yellow-300" />
				</div>
				<div>
					<p class="text-2xl font-bold">{sprintFilteredTickets.filter(t => t.status === 'progress').length}</p>
					<p class="text-gray-600 dark:text-gray-400">In Progress</p>
				</div>
			</div>
		</button>

		<button 
			class="card hover:shadow-lg transition-shadow cursor-pointer text-left w-full"
			on:click={() => activeTab = 'done'}
			title="View completed tickets"
		>
			<div class="flex items-center gap-3">
				<div class="p-2 bg-green-100 dark:bg-green-800 rounded-lg">
					<Done class="w-6 h-6 text-green-600 dark:text-green-300" />
				</div>
				<div>
					<p class="text-2xl font-bold">{sprintFilteredTickets.filter(t => t.status === 'done').length}</p>
					<p class="text-gray-600 dark:text-gray-400">Completed</p>
				</div>
			</div>
		</button>
	</div>

	<!-- Tabs (only shown in grid view) -->
	{#if viewMode === 'grid'}
		<div class="mb-6">
			<nav class="flex space-x-1">
			{#each [
				{ id: 'all-open', label: 'All Open', count: sprintFilteredTickets.filter(t => t.status !== 'done').length },
				{ id: 'open-tasks', label: 'Open Tasks', count: sprintFilteredTickets.filter(t => t.type === 'task' && t.status !== 'done').length },
				{ id: 'open-bugs', label: 'Open Bugs', count: sprintFilteredTickets.filter(t => t.type === 'bug' && t.status !== 'done').length },
				{ id: 'todo', label: 'To Do', count: sprintFilteredTickets.filter(t => t.status === 'todo').length },
				{ id: 'progress', label: 'In Progress', count: sprintFilteredTickets.filter(t => t.status === 'progress').length },
				{ id: 'done', label: 'Done', count: sprintFilteredTickets.filter(t => t.status === 'done').length },
				{ id: 'all', label: 'All Tickets', count: sprintFilteredTickets.length }
			] as tab}
				<button
					class="px-4 py-2 rounded-lg text-sm font-medium transition-colors
						{activeTab === tab.id 
						? 'bg-blue-100 text-blue-700 border border-blue-200 dark:bg-blue-900 dark:text-blue-300 dark:border-blue-700' 
						: 'text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700'}"
					on:click={() => activeTab = tab.id}
				>
					{tab.label}
					{#if tab.count > 0}
						<span class="ml-2 px-2 py-0.5 bg-gray-200 {activeTab === tab.id ? 'bg-blue-200 dark:bg-blue-800' : 'dark:bg-gray-600'} rounded-full text-xs">
							{tab.count}
						</span>
					{/if}
				</button>
			{/each}
		</nav>
	</div>
	{/if}

	<!-- Tickets Display -->
	{#if viewMode === 'kanban'}
		<!-- Kanban Board View -->
		<KanbanBoard 
			tickets={filteredTickets}
			on:updated={loadData}
			on:edit={(e) => handleEditTicket(e.detail)}
			on:comments={(e) => handleCommentsTicket(e.detail)}
			on:createTicket={(e) => {
				createModalDefaultStatus = e.detail.status;
				showCreateModal = true;
			}}
		/>
	{:else}
		<!-- Grid View -->
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each filteredTickets as ticket (ticket.id)}
				<TicketCard {ticket} on:updated={loadData} on:edit={() => handleEditTicket(ticket)} on:comments={() => handleCommentsTicket(ticket)} />
			{/each}
			
			{#if filteredTickets.length === 0}
				<div class="col-span-full text-center py-12">
					<div class="text-gray-400 mb-4">
						<CheckSquare size={48} class="mx-auto" />
					</div>
					<p class="text-gray-600 dark:text-gray-400 text-lg">No tickets found</p>
					<p class="text-gray-500">Create your first ticket to get started</p>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Create Ticket Modal -->
	{#if showCreateModal}
		<CreateTicketModal 
			defaultStatus={createModalDefaultStatus}
			on:close={() => { 
				showCreateModal = false; 
				createModalDefaultStatus = null;
			}}
			on:created={loadData}
		/>
	{/if}

	<!-- Manage Modal -->
	{#if showManageModal}
		<ManageModal 
			on:close={() => showManageModal = false}
			on:updated={loadData}
		/>
	{/if}

	<!-- Edit Ticket Modal -->
	{#if showEditModal && editingTicket}
		<EditTicketModal 
			ticket={editingTicket}
			on:close={() => { showEditModal = false; editingTicket = null; }}
			on:updated={loadData}
		/>
	{/if}

	<!-- Comments Modal -->
	{#if showCommentsModal && commentsTicket}
		<CommentsModal 
			ticket={commentsTicket}
			isOpen={showCommentsModal}
			on:close={() => { showCommentsModal = false; commentsTicket = null; }}
		/>
	{/if}
</div>

<!-- Drawer Overlay -->
{#if showDrawer}
	<div class="fixed inset-0 bg-black bg-opacity-50 z-40" on:click={() => showDrawer = false} on:keydown={(e) => e.key === 'Escape' && (showDrawer = false)}></div>
{/if}

<!-- Drawer -->
<div class="fixed top-0 right-0 h-full w-80 bg-white dark:bg-gray-800 shadow-xl transform transition-transform duration-300 ease-in-out z-50 {showDrawer ? 'translate-x-0' : 'translate-x-full'}">
	<div class="p-6">
		<!-- Drawer Header -->
		<div class="flex items-center justify-between mb-6">
			<h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">Search & Filters</h2>
			<button 
				class="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
				on:click={() => showDrawer = false}
			>
				<X size={20} />
			</button>
		</div>

		<!-- Search Input -->
		<div class="mb-6">
			<div class="flex items-center justify-between mb-2">
				<label for="drawer-search" class="label">
					Search Tickets
				</label>
				{#if searchTerm}
					<button
						class="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 underline"
						on:click={() => searchTerm = ''}
					>
						Clear
					</button>
				{/if}
			</div>
			<input 
				id="drawer-search"
				type="text"
				placeholder="Search by title, description, or ID..."
				bind:value={searchTerm}
				class="input w-full"
			/>
		</div>

		<!-- Sort Options -->
		<div class="mb-6">
			<label for="drawer-sort-by" class="label">
				Sort by
			</label>
			<div class="space-y-2">
				<select 
					id="drawer-sort-by"
					bind:value={sortBy}
					class="select w-full">
					<option value="updated">Updated</option>
					<option value="created">Created</option>
					<option value="title">Title</option>
					<option value="priority">Priority</option>
					<option value="status">Status</option>
				</select>
				<select 
					bind:value={sortOrder}
					class="select w-full">
					<option value="asc">Ascending</option>
					<option value="desc">Descending</option>
				</select>
			</div>
		</div>

		<!-- Sprint Filter -->
		<div class="mb-6">
			<label for="drawer-sprint-filter" class="label">
				Filter by Sprint
			</label>
			<select 
				id="drawer-sprint-filter"
				bind:value={selectedSprint}
				class="select w-full"
			>
				<option value="all">All Tickets</option>
				<option value="no-sprint">No Sprint</option>
				{#each $sprintStore.filter(s => s.status !== 'completed') as sprint}
					<option value={sprint.id}>{sprint.name}</option>
				{/each}
			</select>
		</div>

		<!-- Settings Actions -->
		<div class="mb-6 pt-4 border-t border-gray-200 dark:border-gray-600">
			<button 
				class="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 underline w-full text-center"
				on:click={resetUISettings}
				title="Reset all view preferences to defaults"
			>
				Reset View Settings
			</button>
		</div>

		<!-- Manage Button -->
		
		<div>
			<label for="drawer-manage-btn" class="label">
				Users & Sprints
			</label>
			<button id="drawer-manage-btn" 
			class="btn btn-secondary w-full flex items-center justify-center gap-2"
			on:click={() => { showManageModal = true; showDrawer = false; }}
		>
			Manage
		</button>
		</div>
	</div>
</div>

<!-- Floating Action Button -->
<button 
	class="fab"
	on:click={() => showCreateModal = true}
	title="Create New Ticket"
>
	<Plus size={24} />
</button>

<style>
	.view-toggle-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-radius: 0.375rem;
		transition: all 200ms ease;
		color: rgb(75, 85, 99);
		cursor: pointer;
		border: none;
		background: transparent;
		font-size: 0.875rem;
	}
	
	:global(.dark) .view-toggle-btn {
		color: rgb(156, 163, 175);
	}
	
	.view-toggle-btn:hover {
		color: rgb(31, 41, 55);
	}
	
	:global(.dark) .view-toggle-btn:hover {
		color: rgb(229, 231, 235);
	}
	
	.view-toggle-btn.active {
		background: white;
		color: rgb(17, 24, 39);
		box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
	}
	
	:global(.dark) .view-toggle-btn.active {
		background: rgb(75, 85, 99);
		color: white;
	}

	/* Floating Action Button */
	.fab {
		position: fixed;
		bottom: 2rem;
		right: 2rem;
		width: 3.5rem;
		height: 3.5rem;
		border-radius: 50%;
		background: rgb(59, 130, 246);
		color: white;
		border: none;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
		transition: all 200ms ease;
		z-index: 30;
	}

	.fab:hover {
		background: rgb(37, 99, 235);
		transform: scale(1.1);
		box-shadow: 0 6px 16px rgba(59, 130, 246, 0.6);
	}

	.fab:active {
		transform: scale(0.95);
	}
</style>