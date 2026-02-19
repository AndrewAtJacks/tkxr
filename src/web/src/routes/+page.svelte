<script lang="ts">
	import { onMount } from 'svelte';
	import Plus from '../lib/icons/Plus.svelte';
	import Bug from '../lib/icons/Bug.svelte';
	import CheckSquare from '../lib/icons/CheckSquare.svelte';
	import Clock from '../lib/icons/Clock.svelte';
	import Done from '../lib/icons/Check.svelte';
	import TicketCard from '../lib/TicketCard.svelte';
	import CreateTicketModal from '../lib/CreateTicketModal.svelte';
	import ManageModal from '../lib/ManageModal.svelte';
	import EditTicketModal from '../lib/EditTicketModal.svelte';
	import { ticketStore, sprintStore, userStore } from '../lib/stores';

	let showCreateModal = false;
	let showManageModal = false;
	let showEditModal = false;
	let editingTicket = null;
	let activeTab = 'all';
	let selectedSprint = 'all'; // all, no-sprint, or sprint ID
	let searchTerm = '';
	let sortBy = 'updated'; // updated, created, title, priority, status
	let sortOrder = 'desc'; // asc, desc
	
	onMount(() => {
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
			
			if (message.type === 'ticket_created' || message.type === 'ticket_updated') {
				loadData(); // Simple refresh for now
			}
		};
	}

	function handleEditTicket(ticket) {
		editingTicket = ticket;
		showEditModal = true;
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
			
			// Tab filter
			if (activeTab === 'all') return true;
			if (activeTab === 'tasks') return ticket.type === 'task';
			if (activeTab === 'bugs') return ticket.type === 'bug';
			if (activeTab === 'todo') return ticket.status === 'todo';
			if (activeTab === 'progress') return ticket.status === 'progress';
			if (activeTab === 'done') return ticket.status === 'done';
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
					compareValue = (priorityOrder[b.priority] || 1) - (priorityOrder[a.priority] || 1);
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
</script>

<svelte:head>
	<title>tkxr - Dashboard</title>
</svelte:head>

<div class="container mx-auto px-4 py-8">
	<!-- Header -->
	<header class="mb-8">
		<div class="flex items-center justify-between">
			<div>
				<h1 class="text-3xl font-bold text-gray-900">tkxr</h1>
				<p class="text-gray-600">In-repo ticket management</p>
			</div>
			<div class="flex items-center gap-4">
				<!-- Search Input -->
				<div class="relative">
					<label for="search" class="block text-sm font-medium text-gray-700 mb-1">
						Search Tickets
					</label>
					<input 
						id="search"
						type="text"
						placeholder="Search by title, description, or ID..."
						bind:value={searchTerm}
						class="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 w-64"
					/>
				</div>

				<!-- Sort Options -->
				<div class="relative">
					<label for="sort-by" class="block text-sm font-medium text-gray-700 mb-1">
						Sort by
					</label>
					<div class="flex gap-2">
						<select 
							id="sort-by"
							bind:value={sortBy}
							class="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
						>
							<option value="updated">Updated</option>
							<option value="created">Created</option>
							<option value="title">Title</option>
							<option value="priority">Priority</option>
							<option value="status">Status</option>
						</select>
						<select 
							bind:value={sortOrder}
							class="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
						>
							<option value="asc">A-Z</option>
							<option value="desc">Z-A</option>
						</select>
					</div>
				</div>

				<!-- Sprint Filter Dropdown -->
				<div class="relative">
					<label for="sprint-filter" class="block text-sm font-medium text-gray-700 mb-1">
						Filter by Sprint
					</label>
					<select 
						id="sprint-filter"
						bind:value={selectedSprint}
						class="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
					>
						<option value="all">All Tickets</option>
						<option value="no-sprint">No Sprint</option>
						{#each $sprintStore.filter(s => s.status !== 'completed') as sprint}
							<option value={sprint.id}>{sprint.name}</option>
						{/each}
					</select>
				</div>
				
				<div class="flex gap-2">
					<button 
						class="btn btn-primary flex items-center gap-2"
						on:click={() => showCreateModal = true}
					>
						<Plus size={20} />
						New Ticket
					</button>
					<button 
						class="btn btn-secondary flex items-center gap-2"
						on:click={() => showManageModal = true}
					>
						Manage
					</button>
				</div>
			</div>
		</div>
	</header>

	<!-- Stats -->
	<div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
		<div class="card">
			<div class="flex items-center gap-3">
				<div class="p-2 bg-blue-100 rounded-lg">
					<CheckSquare class="w-6 h-6 text-blue-600" />
				</div>
				<div>
					<p class="text-2xl font-bold">{sprintFilteredTickets.length}</p>
					<p class="text-gray-600">Total Tickets</p>
				</div>
			</div>
		</div>

		<div class="card">
			<div class="flex items-center gap-3">
				<div class="p-2 bg-red-100 rounded-lg">
					<Bug class="w-6 h-6 text-red-600" />
				</div>
				<div>
					<p class="text-2xl font-bold">{sprintFilteredTickets.filter(t => t.type === 'bug').length}</p>
					<p class="text-gray-600">Bugs</p>
				</div>
			</div>
		</div>

		<div class="card">
			<div class="flex items-center gap-3">
				<div class="p-2 bg-yellow-100 rounded-lg">
					<Clock class="w-6 h-6 text-yellow-600" />
				</div>
				<div>
					<p class="text-2xl font-bold">{sprintFilteredTickets.filter(t => t.status === 'progress').length}</p>
					<p class="text-gray-600">In Progress</p>
				</div>
			</div>
		</div>

		<div class="card">
			<div class="flex items-center gap-3">
				<div class="p-2 bg-green-100 rounded-lg">
					<Done class="w-6 h-6 text-green-600" />
				</div>
				<div>
					<p class="text-2xl font-bold">{sprintFilteredTickets.filter(t => t.status === 'done').length}</p>
					<p class="text-gray-600">Completed</p>
				</div>
			</div>
		</div>
	</div>

	<!-- Tabs -->
	<div class="mb-6">
		<nav class="flex space-x-1">
			{#each [
				{ id: 'all', label: 'All Tickets', count: sprintFilteredTickets.length },
				{ id: 'tasks', label: 'Tasks', count: sprintFilteredTickets.filter(t => t.type === 'task').length },
				{ id: 'bugs', label: 'Bugs', count: sprintFilteredTickets.filter(t => t.type === 'bug').length },
				{ id: 'todo', label: 'To Do', count: sprintFilteredTickets.filter(t => t.status === 'todo').length },
				{ id: 'progress', label: 'In Progress', count: sprintFilteredTickets.filter(t => t.status === 'progress').length },
				{ id: 'done', label: 'Done', count: sprintFilteredTickets.filter(t => t.status === 'done').length }
			] as tab}
				<button
					class="px-4 py-2 rounded-lg text-sm font-medium transition-colors
						{activeTab === tab.id 
							? 'bg-blue-100 text-blue-700 border border-blue-200' 
							: 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'}"
					on:click={() => activeTab = tab.id}
				>
					{tab.label}
					{#if tab.count > 0}
						<span class="ml-2 px-2 py-0.5 bg-gray-200 {activeTab === tab.id ? 'bg-blue-200' : ''} rounded-full text-xs">
							{tab.count}
						</span>
					{/if}
				</button>
			{/each}
		</nav>
	</div>

	<!-- Tickets Grid -->
	<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
		{#each filteredTickets as ticket (ticket.id)}
			<TicketCard {ticket} on:updated={loadData} on:edit={() => handleEditTicket(ticket)} />
		{/each}
		
		{#if filteredTickets.length === 0}
			<div class="col-span-full text-center py-12">
				<div class="text-gray-400 mb-4">
					<CheckSquare size={48} class="mx-auto" />
				</div>
				<p class="text-gray-600 text-lg">No tickets found</p>
				<p class="text-gray-500">Create your first ticket to get started</p>
			</div>
		{/if}
	</div>

	<!-- Create Ticket Modal -->
	{#if showCreateModal}
		<CreateTicketModal 
			on:close={() => showCreateModal = false}
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
</div>