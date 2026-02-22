<script lang="ts">
	// @ts-ignore 
	declare global {
		interface Window {
			tkxrWebSocket: WebSocket | null;
		}
	}

	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
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
	import SprintManagementModal from '../lib/SprintManagementModal.svelte';
	import UserManagementModal from '../lib/UserManagementModal.svelte';
	import EditTicketModal from '../lib/EditTicketModal.svelte';
	import CommentsModal from '../lib/CommentsModal.svelte';
	import DarkModeToggle from '../lib/DarkModeToggle.svelte';
	import { ticketStore, sprintStore, userStore } from '../lib/stores';

	let showCreateModal = false;
	let showSprintModal = false;
	let showUserModal = false;
	let showEditModal = false;
	let showCommentsModal = false;
	let editingTicket = null;
	let commentsTicket = null;
	let activeTab = 'all-open';
	let selectedSprint = 'all'; // all, no-sprint, or sprint ID
	let selectedUser = 'all'; // all, or user ID
	let searchTerm = '';
	let sprintSearchTerm = '';
	let sprintComboboxOpen = false;
	let sprintComboboxFocusedIndex = -1;
	let sortBy = 'updated'; // updated, created, title, priority, status
	let sortOrder = 'desc'; // asc, desc
	let viewMode = 'grid'; // 'grid' or 'kanban'
	let createModalDefaultStatus: 'todo' | 'progress' | 'done' | null = null;
	let showDrawer = false;
	let settingsLoaded = false; // Flag to prevent saving during initial load
	let appVersion = 'v1.0.0'; // Will be updated from server

	// WebSocket connection management
	let ws: WebSocket | null = null;
	let wsReconnectAttempts = 0;
	let wsMaxReconnectAttempts = 5;
	let wsReconnectTimeout: number;
	let wsHeartbeatInterval: number;

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
				selectedUser = settings.selectedUser || 'all';				
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
				selectedUser,
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
			selectedUser = 'all';
			searchTerm = '';
			sortBy = 'updated';
			sortOrder = 'desc';
			viewMode = 'grid';
		} catch (error) {
			console.warn('Failed to reset UI settings:', error);
		}
	}

	// Reactive statements to save settings when they change (but not during initial load)
	$: if (settingsLoaded && typeof window !== 'undefined' && (activeTab, selectedSprint, selectedUser, searchTerm, sortBy, sortOrder, viewMode, true)) {
		saveUISettings();
	}
	
	onMount(() => {
		enableSettingsPersistence(); // Enable settings saving after component mounts
		loadData();
		setupWebSocket();

		// Click outside handler for sprint combobox
		const handleClickOutside = (event: MouseEvent) => {
			const target = event.target as HTMLElement;
			const combobox = document.getElementById('drawer-sprint-combobox');
			const dropdown = combobox?.nextElementSibling?.nextElementSibling;
			
			if (combobox && dropdown && 
				!combobox.contains(target) && 
				!dropdown.contains(target)) {
				sprintComboboxOpen = false;
				sprintSearchTerm = '';
				sprintComboboxFocusedIndex = -1;
			}
		};

		document.addEventListener('click', handleClickOutside);
		
		return () => {
			document.removeEventListener('click', handleClickOutside);
		};
	});
	
	onDestroy(() => {
		cleanupWebSocket();
	});

	// Helper function to truncate long text with ellipsis
	function truncate(text: string, maxLength: number): string {
		if (text.length <= maxLength) return text;
		return text.substring(0, maxLength - 3) + '...';
	}

	async function loadData(retryCount = 0) {
		try {
			console.debug('Loading data...', retryCount > 0 ? `(retry ${retryCount})` : '');
			
			// Load all data concurrently via Vite proxy
			const [ticketsRes, sprintsRes, usersRes, configRes] = await Promise.all([
				fetch('/api/tickets'),
				fetch('/api/sprints'),
				fetch('/api/users'),
				fetch('/api/config')
			]);

			let hasErrors = false;

			if (ticketsRes.ok) {
				const tickets = await ticketsRes.json();
				ticketStore.set(tickets);
				console.debug('Loaded', tickets.length, 'tickets');
			} else {
				console.error('Failed to load tickets:', ticketsRes.status, ticketsRes.statusText);
				hasErrors = true;
			}

			if (sprintsRes.ok) {
				const sprints = await sprintsRes.json();
				sprintStore.set(sprints);
				console.debug('Loaded', sprints.length, 'sprints');
			} else {
				console.error('Failed to load sprints:', sprintsRes.status, sprintsRes.statusText);
				hasErrors = true;
			}

			if (usersRes.ok) {
				const users = await usersRes.json();
				userStore.set(users);
				console.debug('Loaded', users.length, 'users');
			} else {
				console.error('Failed to load users:', usersRes.status, usersRes.statusText);
				hasErrors = true;
			}

			if (configRes.ok) {
				const config = await configRes.json();
				if (config.version) {
					appVersion = `v${config.version}`;
				}
				console.debug('Server version:', config.version);
			} else {
				console.debug('Failed to load config:', configRes.status);
			}

			if (hasErrors && retryCount < 3) {
				// Retry with exponential backoff if there were errors
				const delay = Math.min(1000 * Math.pow(2, retryCount), 5000);
				console.debug(`Retrying data load in ${delay}ms (attempt ${retryCount + 1}/3)`);
				setTimeout(() => loadData(retryCount + 1), delay);
			}

		} catch (error) {
			console.error('Failed to load data:', error);
			
			// Retry with exponential backoff for network errors
			if (retryCount < 3) {
				const delay = Math.min(1000 * Math.pow(2, retryCount), 5000);
				console.debug(`Retrying data load in ${delay}ms due to error (attempt ${retryCount + 1}/3)`);
				setTimeout(() => loadData(retryCount + 1), delay);
			}
		}
	}

	function setupWebSocket() {
		if (!browser) return;
		
		// Close existing connection if any
		if (ws) {
			ws.close();
		}
		
		try {
			const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
			// Connect directly to the same server for WebSocket
			console.debug('Attempting WebSocket connection to:', `${protocol}//${window.location.host}`);
			ws = new WebSocket(`${protocol}//${window.location.host}`);
			
			ws.onopen = () => {
				console.debug('WebSocket connected successfully');
				wsReconnectAttempts = 0; // Reset reconnect attempts on successful connection
				
				// Make WebSocket available globally for other components
				if (browser) {
					window.tkxrWebSocket = ws;
				}
				
				// Set up heartbeat to keep connection alive
				wsHeartbeatInterval = window.setInterval(() => {
					if (ws && ws.readyState === WebSocket.OPEN) {
						ws.send(JSON.stringify({ type: 'ping' }));
					}
				}, 30000); // Ping every 30 seconds
			};
			
			ws.onmessage = (event) => {
				try {
					const message = JSON.parse(event.data);
					console.debug('WebSocket message received:', message);
					
					// Handle pong responses
					if (message.type === 'pong') {
						return;
					}
					
					// Handle data updates
					if (message.type === 'ticket_created' || 
						message.type === 'ticket_updated' || 
						message.type === 'ticket_deleted' ||
						message.type === 'sprint_created' ||
						message.type === 'sprint_updated' ||
						message.type === 'sprint_deleted' ||
						message.type === 'user_created' ||
						message.type === 'user_updated' ||
						message.type === 'user_deleted' ||
						message.type === 'comment_created' ||
						message.type === 'comment_deleted') {
						console.debug('Data update received, reloading...');
						loadData(); // Reload data when updates occur
					}
				} catch (error) {
					console.error('Error parsing WebSocket message:', error, event.data);
				}
			};
			
			ws.onclose = (event) => {
				console.debug('WebSocket closed:', event.code, event.reason);
				
				// Clear global reference
				if (browser && window.tkxrWebSocket === ws) {
					window.tkxrWebSocket = null;
				}
				
				// Clear heartbeat interval
				if (wsHeartbeatInterval) {
					clearInterval(wsHeartbeatInterval);
				}
				
				// Attempt reconnection if not intentionally closed and haven't exceeded max attempts
				if (event.code !== 1000 && wsReconnectAttempts < wsMaxReconnectAttempts) {
					wsReconnectAttempts++;
					const delay = Math.min(1000 * Math.pow(2, wsReconnectAttempts - 1), 30000); // Exponential backoff, max 30s
					
					console.debug(`WebSocket reconnect attempt ${wsReconnectAttempts}/${wsMaxReconnectAttempts} in ${delay}ms`);
					
					wsReconnectTimeout = window.setTimeout(() => {
						setupWebSocket();
					}, delay);
				} else {
					console.warn('WebSocket connection failed after', wsMaxReconnectAttempts, 'attempts');
				}
			};
			
			ws.onerror = (error) => {
				console.error('WebSocket error:', error);
			};
			
		} catch (error) {
			console.error('Failed to create WebSocket connection:', error);
		}
	}
	
	// Clean up WebSocket connection when component is destroyed
	function cleanupWebSocket() {
		if (wsReconnectTimeout) {
			clearTimeout(wsReconnectTimeout);
		}
		if (wsHeartbeatInterval) {
			clearInterval(wsHeartbeatInterval);
		}
		if (ws) {
			ws.close(1000); // Normal closure
			ws = null;
		}
	}

	function handleEditTicket(ticket) {
		editingTicket = ticket;
		showEditModal = true;
	}

	function handleCommentsTicket(ticket) {
		commentsTicket = ticket;
		showCommentsModal = true;
	}

	// Sprint combobox handlers
	function getSprintDisplayName(sprintId: string) {
		if (sprintId === 'all') return 'Filter by Sprint...';
		if (sprintId === 'no-sprint') return 'Unassigned';
		const sprint = $sprintStore.find(s => s.id === sprintId);
		return sprint ? sprint.name : 'Unknown Sprint';
	}

	function selectSprintOption(sprintId: string) {
		selectedSprint = sprintId;
		sprintComboboxOpen = false;
		sprintSearchTerm = '';
		sprintComboboxFocusedIndex = -1;
	}

	function clearSprintFilter() {
		selectedSprint = 'all';
		sprintSearchTerm = '';
		sprintComboboxFocusedIndex = -1;
	}

	function handleSprintComboboxKeydown(e: KeyboardEvent) {
		const options = [
			...filteredSprints.map(s => ({ id: s.id, name: s.name })),
			{ id: 'no-sprint', name: 'Unassigned' }
		];

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			sprintComboboxOpen = true;
			sprintComboboxFocusedIndex = Math.min(sprintComboboxFocusedIndex + 1, options.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			sprintComboboxFocusedIndex = Math.max(sprintComboboxFocusedIndex - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (sprintComboboxFocusedIndex >= 0 && sprintComboboxFocusedIndex < options.length) {
				selectSprintOption(options[sprintComboboxFocusedIndex].id);
			}
		} else if (e.key === 'Escape') {
			e.preventDefault();
			sprintComboboxOpen = false;
			sprintSearchTerm = '';
			sprintComboboxFocusedIndex = -1;
		}
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

	// Filter sprints for dropdown (exclude completed, apply search)
	$: filteredSprints = $sprintStore
		.filter(s => s.status !== 'completed')
		.filter(s => {
			if (!sprintSearchTerm.trim()) return true;
			const term = sprintSearchTerm.toLowerCase();
			return s.name.toLowerCase().includes(term) || 
			       (s.description && s.description.toLowerCase().includes(term));
		})
		.sort((a, b) => {
			// Sort matches to the top
			if (!sprintSearchTerm.trim()) return 0;
			const term = sprintSearchTerm.toLowerCase();
			const aNameMatch = a.name.toLowerCase().includes(term);
			const bNameMatch = b.name.toLowerCase().includes(term);
			if (aNameMatch && !bNameMatch) return -1;
			if (!aNameMatch && bNameMatch) return 1;
			return a.name.localeCompare(b.name);
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

<!-- Skip links for keyboard navigation -->
<div class="sr-only focus-within:not-sr-only">
	<a href="#main-content" class="absolute top-0 left-0 bg-blue-600 text-white p-2 rounded-md m-2 z-50">
		Skip to main content
	</a>
	<a href="#search" class="absolute top-0 left-0 bg-blue-600 text-white p-2 rounded-md m-2 z-50">
		Skip to search
	</a>
</div>

<div class="container mx-auto px-4 py-8">
	<!-- Header -->
	<header class="mb-8">
		<div class="flex items-center justify-between">
			<div>
				<h1 class="text-3xl font-bold text-gray-900 dark:text-gray-100">tkxr</h1>
				<div class="flex items-center gap-2">
					<p class="text-gray-600 dark:text-gray-400">In-repo ticket management</p>
					<span class="text-xs text-gray-500 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">{appVersion}</span>
				</div>
			</div>
			<nav class="flex items-center gap-4" aria-label="Application controls">
				<DarkModeToggle />
				
				<!-- View Toggle -->
				<fieldset class="relative">
					<legend class="sr-only">Choose view mode</legend>
					<div class="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-1" role="radiogroup" aria-label="View mode">
						<button 
							class="view-toggle-btn {viewMode === 'grid' ? 'active' : ''}"
							on:click={() => viewMode = 'grid'}
							title="Grid View"
							role="radio"
							aria-checked={viewMode === 'grid'}
							aria-label="Grid view"
						>
							<Grid size={16} aria-hidden="true" />
							<span class="hidden sm:inline">Grid</span>
						</button>
						<button 
							class="view-toggle-btn {viewMode === 'kanban' ? 'active' : ''}"
							on:click={() => viewMode = 'kanban'}
							title="Kanban Board"
							role="radio"
							aria-checked={viewMode === 'kanban'}
							aria-label="Kanban board view"
						>
							<Columns size={16} aria-hidden="true" />
							<span class="hidden sm:inline">Board</span>
						</button>
					</div>
				</fieldset>
				<!-- Hamburger Menu Button -->
				<div class="relative">
					<button 
						class="btn btn-secondary flex items-center gap-2"
						on:click={() => showDrawer = true}
						title="Search and Filters"
						aria-label="Open search and filter options"
						aria-expanded={showDrawer}
						aria-controls="filter-drawer"
					>
						<Menu size={20} aria-hidden="true" />
					</button>
					
					<!-- Filter Active Badge -->
					{#if searchTerm}
						<div class="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full border-2 border-white dark:border-gray-800" 
							 aria-hidden="true" title="Active filters applied"></div>
					{/if}
				</div>
			</nav>
		</div>

		<!-- Sprint Progress Bar -->
		{#if sprintProgress.isVisible}
			<section class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-600 p-4 shadow-sm mb-4 mt-6" 
				 aria-labelledby="sprint-progress-title">
				<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
					<h2 id="sprint-progress-title" class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate flex-1 min-w-0">
						{sprintProgress.sprintName} Progress
					</h2>
					<span class="text-sm font-medium text-gray-600 dark:text-gray-400 whitespace-nowrap" 
						  aria-label="Sprint progress details"
						  title="{sprintProgress.completedPoints} of {sprintProgress.totalPoints} points completed ({sprintProgress.percentage}% done)">
						{sprintProgress.completedPoints} / {sprintProgress.totalPoints} points ({sprintProgress.percentage}%)
					</span>
				</div>
				<div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3" role="progressbar" 
					 aria-valuenow={sprintProgress.percentage} 
					 aria-valuemin="0" 
					 aria-valuemax="100"
					 aria-label="Sprint completion progress">
					<div 
						class="h-3 rounded-full transition-all duration-500 ease-out"
						class:bg-gray-300={sprintProgress.percentage === 0}
						class:bg-red-500={sprintProgress.percentage > 0 && sprintProgress.percentage <= 25}
						class:bg-yellow-500={sprintProgress.percentage > 25 && sprintProgress.percentage <= 75}
						class:bg-green-500={sprintProgress.percentage > 75}
						style="width: {sprintProgress.percentage}%"
					></div>
				</div>
			</section>
		{/if}
	</header>

	<!-- Stats -->
	<section class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8" aria-labelledby="ticket-stats-title">
		<h2 id="ticket-stats-title" class="sr-only">Ticket Statistics</h2>
		<button 
			class="card hover:shadow-lg transition-shadow cursor-pointer text-left w-full"
			on:click={() => { activeTab = 'all'; viewMode = 'grid'; }}
			title="View all tickets"
			aria-label="View all tickets: {sprintFilteredTickets.length} total"
			aria-pressed={activeTab === 'all'}
		>
			<div class="flex items-center gap-3">
				<div class="p-2 bg-blue-100 dark:bg-blue-800 rounded-lg" aria-hidden="true">
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
			on:click={() => { activeTab = 'open-tasks'; viewMode = 'grid'; }}
			title="View open tasks"
			aria-label="View open tasks: {sprintFilteredTickets.filter(t => t.type === 'task' && t.status !== 'done').length} total"
			aria-pressed={activeTab === 'open-tasks'}
		>
			<div class="flex items-center gap-3">
				<div class="p-2 bg-purple-100 dark:bg-purple-800 rounded-lg" aria-hidden="true">
					<CheckSquare class="w-6 h-6 text-purple-600 dark:text-purple-300" />
				</div>
				<div>
					<p class="text-2xl font-bold">{sprintFilteredTickets.filter(t => t.type === 'task' && t.status !== 'done').length}</p>
					<p class="text-gray-600 dark:text-gray-400">Open Tasks</p>
				</div>
			</div>
		</button>

		<button 
			class="card hover:shadow-lg transition-shadow cursor-pointer text-left w-full"
			on:click={() => { activeTab = 'open-bugs'; viewMode = 'grid'; }}
			title="View open bugs"
			aria-label="View open bugs: {sprintFilteredTickets.filter(t => t.type === 'bug' && t.status !== 'done').length} total"
			aria-pressed={activeTab === 'open-bugs'}
		>
			<div class="flex items-center gap-3">
				<div class="p-2 bg-red-100 dark:bg-red-800 rounded-lg" aria-hidden="true">
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
			on:click={() => { activeTab = 'progress'; viewMode = 'grid'; }}
			title="View tickets in progress"
			aria-label="View tickets in progress: {sprintFilteredTickets.filter(t => t.status === 'progress').length} total"
			aria-pressed={activeTab === 'progress'}
		>
			<div class="flex items-center gap-3">
				<div class="p-2 bg-yellow-100 dark:bg-yellow-800 rounded-lg" aria-hidden="true">
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
			on:click={() => { activeTab = 'done'; viewMode = 'grid'; }}
			title="View completed tickets"
			aria-label="View completed tickets: {sprintFilteredTickets.filter(t => t.status === 'done').length} total"
			aria-pressed={activeTab === 'done'}
		>
			<div class="flex items-center gap-3">
				<div class="p-2 bg-green-100 dark:bg-green-800 rounded-lg" aria-hidden="true">
					<Done class="w-6 h-6 text-green-600 dark:text-green-300" />
				</div>
				<div>
					<p class="text-2xl font-bold">{sprintFilteredTickets.filter(t => t.status === 'done').length}</p>
					<p class="text-gray-600 dark:text-gray-400">Completed</p>
				</div>
			</div>
		</button>
	</section>

	<!-- Tabs (only shown in grid view) -->
	{#if viewMode === 'grid'}
		<div class="mb-6">
			<div class="flex space-x-1" role="tablist" aria-label="Filter tickets">
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
					role="tab"
					aria-selected={activeTab === tab.id}
					aria-controls="tickets-content"
					id="tab-{tab.id}"
				>
					{tab.label}
					{#if tab.count > 0}
						<span class="ml-2 px-2 py-0.5 bg-gray-200 {activeTab === tab.id ? 'bg-blue-200 dark:bg-blue-800' : 'dark:bg-gray-600'} rounded-full text-xs" 
							  aria-label="{tab.count} tickets">
							{tab.count}
						</span>
					{/if}
				</button>
			{/each}
		</div>
	</div>
	{/if}

	<!-- Tickets Display -->
	<main id="main-content" aria-live="polite">
		{#if viewMode === 'kanban'}
			<!-- Kanban Board View -->
			<div id="tickets-content" 
					 role="tabpanel" 
					 aria-labelledby="kanban-view"
					 aria-label="Kanban board view of tickets">
				<h2 id="kanban-view" class="sr-only">Kanban Board View</h2>
				<KanbanBoard 
					tickets={filteredTickets}
					onUpdateTicket={(ticket) => loadData()}
					on:updated={loadData}
					on:edit={(e) => handleEditTicket(e.detail)}
					on:comments={(e) => handleCommentsTicket(e.detail)}
					on:createTicket={(e) => {
						createModalDefaultStatus = e.detail.status;
						showCreateModal = true;
					}}
				/>
			</div>
		{:else}
			<!-- Grid View -->
			<div id="tickets-content" 
					 role="tabpanel" 
					 aria-labelledby="tab-{activeTab}"
					 aria-label="Grid view of {activeTab} tickets">
				<h2 class="sr-only">Tickets Grid View: {activeTab}</h2>
				<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
					{#each filteredTickets as ticket (ticket.id)}
						<TicketCard {ticket} on:updated={loadData} on:edit={() => handleEditTicket(ticket)} on:comments={() => handleCommentsTicket(ticket)} />
					{/each}
					
					{#if filteredTickets.length === 0}
						<div class="col-span-full text-center py-12" role="status" aria-live="polite">
							<div class="text-gray-400 mb-4" aria-hidden="true">
								<CheckSquare size={48} class="mx-auto" />
							</div>
							<p class="text-gray-600 dark:text-gray-400 text-lg">No tickets found</p>
							<p class="text-gray-500">Create your first ticket to get started</p>
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</main>

	<!-- Create Ticket Modal -->
	{#if showCreateModal}
		<CreateTicketModal 
			defaultStatus={createModalDefaultStatus}
			defaultAssignee={selectedUser !== 'all' ? selectedUser : ''}
			on:close={() => { 
				showCreateModal = false; 
				createModalDefaultStatus = null;
			}}
			on:created={loadData}
		/>
	{/if}

	<!-- Sprint Management Modal -->
	{#if showSprintModal}
		<SprintManagementModal 
			on:close={() => showSprintModal = false}
			on:updated={loadData}
		/>
	{/if}

	<!-- User Management Modal -->
	{#if showUserModal}
		<UserManagementModal 
			on:close={() => showUserModal = false}
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
			defaultAuthor={selectedUser !== 'all' ? selectedUser : ''}
			on:close={() => { showCommentsModal = false; commentsTicket = null; }}
		/>
	{/if}
</div>

<!-- Drawer Overlay -->
{#if showDrawer}
	<div class="fixed inset-0 bg-black bg-opacity-50 z-40" role="button" tabindex="0" aria-label="Close drawer overlay" on:click={() => showDrawer = false} on:keydown={(e) => e.key === 'Escape' && (showDrawer = false)}></div>
{/if}

<!-- Drawer -->
<div class="fixed top-0 right-0 h-full w-80 bg-white dark:bg-gray-800 shadow-xl transform transition-transform duration-300 ease-in-out z-50 {showDrawer ? 'translate-x-0' : 'translate-x-full'}">
	<div class="p-6">
		<!-- Drawer Header -->
		<div class="flex items-center justify-between mb-6">
			<h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">Options</h2>
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

		<!-- Sprint Filter Combobox -->
		<div class="mb-6 relative">
			<label for="drawer-sprint-combobox" class="label">
				Filter by Sprint
			</label>
			<div class="relative">
				<input
					id="drawer-sprint-combobox"
					type="text"
					placeholder={selectedSprint === 'all' ? 'Filter by Sprint...' : ''}
					value={sprintSearchTerm || (selectedSprint !== 'all' ? getSprintDisplayName(selectedSprint) : '')}
					on:input={(e) => sprintSearchTerm = e.currentTarget.value}
					on:focus={() => { sprintComboboxOpen = true; sprintComboboxFocusedIndex = -1; }}
					on:keydown={handleSprintComboboxKeydown}
					on:click={() => sprintComboboxOpen = true}
					class="input w-full {selectedSprint !== 'all' ? 'pr-16' : 'pr-8'}"
					autocomplete="off"
				>
				{#if selectedSprint !== 'all'}
					<button
						type="button"
						class="absolute right-8 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
						on:click={clearSprintFilter}
						aria-label="Clear sprint filter"
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				{/if}
				<button
					type="button"
					class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
					on:click={() => sprintComboboxOpen = !sprintComboboxOpen}
					aria-label="Toggle sprint dropdown"
				>
					<svg class="w-4 h-4 transition-transform {sprintComboboxOpen ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
					</svg>
				</button>
				
				{#if sprintComboboxOpen}
					<div 
						class="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-y-auto"
						on:click|stopPropagation
					>
						{#each filteredSprints as sprint, i}
							<!-- svelte-ignore a11y-click-events-have-key-events -->
							<!-- svelte-ignore a11y-no-static-element-interactions -->
							<div
								class="px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer {sprintComboboxFocusedIndex === i ? 'bg-gray-100 dark:bg-gray-700' : ''}"
								on:click={() => selectSprintOption(sprint.id)}
								on:mouseenter={() => sprintComboboxFocusedIndex = i}
							>
								<div class="text-sm text-gray-900 dark:text-gray-100">{sprint.name}</div>
								{#if sprint.description}
									<div class="text-xs text-gray-500 dark:text-gray-400 truncate">{sprint.description}</div>
								{/if}
							</div>
						{/each}
						<!-- svelte-ignore a11y-click-events-have-key-events -->
						<!-- svelte-ignore a11y-no-static-element-interactions -->
						<div
							class="px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer {sprintComboboxFocusedIndex === filteredSprints.length ? 'bg-gray-100 dark:bg-gray-700' : ''}"
							on:click={() => selectSprintOption('no-sprint')}
							on:mouseenter={() => sprintComboboxFocusedIndex = filteredSprints.length}
						>
							<div class="text-sm text-gray-900 dark:text-gray-100">Unassigned</div>
						</div>
						{#if filteredSprints.length === 0 && sprintSearchTerm.trim()}
							<div class="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 italic">
								No sprints found
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</div>

		<!-- User Filter -->
		<div class="mb-6">
			<label for="drawer-user-filter" class="label">
				Current User
			</label>
			<select 
				id="drawer-user-filter"
				bind:value={selectedUser}
				class="select w-full"
				disabled={$userStore.length === 0}
			>
				{#if $userStore.length === 0}
					<option value="all">No Users</option>
				{:else}
					<option value="all">All Users</option>
					{#each $userStore as user}
						<option value={user.id}>{user.displayName} (@{user.username})</option>
					{/each}
				{/if}
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

		<!-- Management Buttons -->
		<div class="space-y-3">
			<div>
				<label for="drawer-sprint-btn" class="label">
					Sprint Management
				</label>
				<button id="drawer-sprint-btn" 
					class="btn btn-secondary w-full flex items-center justify-center gap-2"
					on:click={() => { showSprintModal = true; showDrawer = false; }}
				>
					Manage Sprints
				</button>
			</div>
			<div>
				<label for="drawer-user-btn" class="label">
					User Management
				</label>
				<button id="drawer-user-btn" 
					class="btn btn-secondary w-full flex items-center justify-center gap-2"
					on:click={() => { showUserModal = true; showDrawer = false; }}
				>
					Manage Users
				</button>
			</div>
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