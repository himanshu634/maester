<!--
	Settings ("Settings · G final"): accordion groups, so later settings slot in without a
	redesign. Account, then Connections (Dhan, then FRED). An item that needs you (not connected,
	expired or failing) opens on load; which items are open lives here only. After a save or a
	disconnect, focus returns to that item's header and the page says what changed, once.
-->
<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { settingsContent as copy } from '$lib/content/settings';
	import { readMe, type Fetcher } from '$lib/documents/client';
	import type { Me } from '$lib/documents/types';
	import { connectionsApi } from '$lib/settings/client';
	import type { Connection, ConnectionProvider } from '$lib/settings/types';
	import { opensOnLoad, summaryWords, tagWord } from '$lib/settings/view';
	import SectionIssue from '$lib/components/errors/SectionIssue.svelte';
	import Hatch from '$lib/components/loading/Hatch.svelte';
	import ConnectionSection from './ConnectionSection.svelte';
	import SettingsGroup from './SettingsGroup.svelte';
	import SettingsItem from './SettingsItem.svelte';

	const id = $props.id();
	const fetcher: Fetcher = (url, init) => fetch(url, init);
	const api = connectionsApi(fetcher);

	let load = $state<'loading' | 'failed' | 'ready'>('loading');
	let me = $state.raw<Me | null>(null);
	let connections = $state.raw<Connection[]>([]);
	let open = $state<Record<string, boolean>>({});
	let headers = $state<Record<string, HTMLButtonElement | undefined>>({});
	let announcement = $state('');

	async function start() {
		load = 'loading';
		try {
			const [who, list] = await Promise.all([readMe(fetcher), api.list()]);
			me = who;
			connections = list.items;
			open = {
				account: false,
				...Object.fromEntries(list.items.map((c) => [c.provider, opensOnLoad(c)]))
			};
			load = 'ready';
		} catch {
			load = 'failed';
		}
	}

	onMount(start);

	async function settle(provider: ConnectionProvider, message: string) {
		announcement = message;
		await tick();
		headers[provider]?.focus();
	}

	function saved(next: Connection) {
		connections = connections.map((c) => (c.provider === next.provider ? next : c));
		settle(next.provider, copy.providers[next.provider].connected);
	}

	async function removed(provider: ConnectionProvider) {
		try {
			connections = (await api.list()).items;
		} catch {
			connections = connections.map((c) =>
				c.provider === provider
					? { ...c, state: 'not_connected', clientId: null, last4: null, expiresAt: null }
					: c
			);
		}
		settle(provider, copy.providers[provider].disconnected);
	}
</script>

<div class="settings">
	<div class="intro">
		<h1>{copy.heading}</h1>
		<p class="lede">{copy.lede}</p>
	</div>

	{#if load === 'loading'}
		<div class="skeleton" aria-busy="true" aria-describedby="{id}-waiting">
			{#each [1, 2] as group (group)}
				<div aria-hidden="true" class="skeleton-group">
					<Hatch width="10rem" height="1.75rem" />
					<Hatch height="4rem" />
					<Hatch height="4rem" />
				</div>
			{/each}
		</div>
		<p id="{id}-waiting" role="status">{copy.loading}</p>
	{:else if load === 'failed' || !me}
		<SectionIssue
			title={copy.loadFailed.title}
			detail={copy.loadFailed.detail}
			retryLabel={copy.loadFailed.retry}
			onretry={start}
		/>
	{:else}
		<SettingsGroup heading={copy.account.heading}>
			<SettingsItem
				id="{id}-account"
				title={copy.account.title}
				summary={me.user.email}
				state={copy.account.state}
				bind:open={open.account}
			>
				<dl>
					<div>
						<dt>{copy.account.terms.name}</dt>
						<dd>{me.user.name || '—'}</dd>
					</div>
					<div>
						<dt>{copy.account.terms.email}</dt>
						<dd>{me.user.email}</dd>
					</div>
					<div>
						<dt>{copy.account.terms.workspace}</dt>
						<dd>{me.workspaces[0]?.name ?? '—'}</dd>
					</div>
				</dl>
				<p class="muted note">{copy.account.signOutNote}</p>
			</SettingsItem>
		</SettingsGroup>

		<SettingsGroup heading={copy.connections.heading} lede={copy.connections.lede}>
			{#each connections as connection (connection.provider)}
				<SettingsItem
					id="{id}-{connection.provider}"
					title={copy.providers[connection.provider].name}
					summary={summaryWords(connection)}
					state={tagWord(connection)}
					stateStrong={connection.state !== 'connected'}
					bind:open={open[connection.provider]}
					bind:button={headers[connection.provider]}
				>
					<ConnectionSection
						{connection}
						{api}
						primary={connection.provider === 'dhan' && connection.state !== 'connected'}
						onsaved={saved}
						onremoved={() => removed(connection.provider)}
					/>
				</SettingsItem>
			{/each}
		</SettingsGroup>
		<p class="muted note">{copy.connections.disconnectNote}</p>
	{/if}

	<p class="visually-hidden" role="status" aria-live="polite">{announcement}</p>
</div>

<style>
	.settings {
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
		min-width: 0;
	}

	.intro {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	h1 {
		font-stretch: var(--wdth-wide);
		font-weight: 800;
		font-size: 2rem;
		line-height: var(--leading-heading);
		letter-spacing: var(--tracking-heading);
	}

	.lede {
		max-width: var(--measure);
	}

	.note {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
	}

	dl {
		margin: 0 0 var(--space-3);
		border-top: var(--rule) solid var(--ink);
		border-bottom: var(--rule) solid var(--ink);
		max-width: 50rem;
	}

	dl div {
		display: grid;
		grid-template-columns: 8rem minmax(0, 1fr);
		gap: var(--space-4);
		padding: var(--space-3) 0;
	}

	dl div + div {
		border-top: var(--rule-thin) solid var(--ink-muted);
	}

	dt {
		font-weight: 700;
	}

	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}

	.skeleton,
	.skeleton-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.skeleton {
		gap: var(--space-8);
		max-width: 70rem;
	}

	@media (min-width: 768px) {
		h1 {
			font-size: var(--text-2xl);
		}
	}
</style>
