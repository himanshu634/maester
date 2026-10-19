<!--
	Holdings (canvas "Maester Broker Connections", A · Accounts, then one table). The accounts
	ledger first, with each broker's state in words and its one action; then the figure strip and
	one table of what is held across the accounts. Brokers, their fields and their steps come from
	their JSON definitions through /v1/brokers. A trip to the broker's login page comes back here
	with ?broker=…&signedIn=1 or &error=CODE, said once and then taken out of the address.
-->
<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { holdingsContent as copy } from '$lib/content/holdings';
	import { ApiError, readMe, type Fetcher } from '$lib/documents/client';
	import { holdingsApi, type HoldingsApi } from '$lib/holdings/client';
	import type { BrokerSummary, HoldingsSnapshot } from '$lib/holdings/types';
	import { addable, dayWords, returnMessage, type ReturnMessage } from '$lib/holdings/view';
	import Notice from '$lib/components/auth/Notice.svelte';
	import SectionIssue from '$lib/components/errors/SectionIssue.svelte';
	import Hatch from '$lib/components/loading/Hatch.svelte';
	import AccountsLedger from './AccountsLedger.svelte';
	import AddBroker from './AddBroker.svelte';
	import HoldingsLedger from './HoldingsLedger.svelte';
	import HoldingsStrip from './HoldingsStrip.svelte';

	const id = $props.id();
	const fetcher: Fetcher = (url, init) => fetch(url, init);

	let load = $state<'loading' | 'failed' | 'no-key' | 'ready'>('loading');
	let api = $state.raw<HoldingsApi | null>(null);
	let brokers = $state.raw<BrokerSummary[]>([]);
	let snapshot = $state.raw<HoldingsSnapshot | null>(null);
	let adding = $state(false);
	let message = $state<ReturnMessage | null>(null);
	let announcement = $state('');
	let addButton = $state<HTMLButtonElement>();

	const offered = $derived(snapshot ? addable(brokers, snapshot.accounts) : []);
	const empty = $derived(snapshot !== null && snapshot.accounts.length === 0);

	async function start() {
		load = 'loading';
		try {
			const me = await readMe(fetcher);
			const ws = me.workspaces[0]?.id;
			if (!ws) throw new ApiError(404, 'NOT_FOUND', 'no workspace');
			api = holdingsApi(fetcher, ws);
			const [list, snap] = await Promise.all([api.brokers(), api.snapshot()]);
			brokers = list.items;
			snapshot = snap;
			load = 'ready';
			takeReturn();
		} catch (err) {
			load = err instanceof ApiError && err.code === 'INVALID_STATE' ? 'no-key' : 'failed';
		}
	}

	/** Reads what the broker's return left in the address, says it once, and takes it out. */
	function takeReturn() {
		const query = new URLSearchParams(window.location.search);
		message = returnMessage(query, brokers, snapshot?.accounts ?? []);
		if (query.has('broker')) history.replaceState(history.state, '', window.location.pathname);
	}

	async function refresh(said?: string) {
		if (!api) return;
		snapshot = await api.snapshot();
		if (said) announcement = said;
	}

	async function openAdd() {
		adding = true;
		message = null;
	}

	/** A broker on a Settings connection was added and read: show it, and say so. */
	async function added(said: string) {
		await refresh(said);
		await closeAdd();
	}

	async function closeAdd() {
		adding = false;
		await tick();
		addButton?.focus();
	}

	onMount(start);
</script>

<div class="holdings">
	<div class="intro">
		<div class="title">
			<h1>{copy.heading}</h1>
			<span class="tag">{copy.tag}</span>
		</div>
		{#if snapshot && !empty}
			<p class="lede">
				{snapshot.closeDay ? copy.asOf(dayWords(snapshot.closeDay)) : copy.asOfNone}
			</p>
		{:else}
			<p class="lede">{copy.lede}</p>
		{/if}
	</div>

	<p class="visually-hidden" role="status">{announcement}</p>

	{#if load === 'loading'}
		<div class="skeleton" aria-busy="true" aria-describedby="{id}-waiting">
			<div aria-hidden="true" class="skeleton-stack">
				<Hatch width="12rem" height="1.75rem" />
				<Hatch height="9rem" />
				<Hatch height="6rem" />
				<Hatch height="14rem" />
			</div>
		</div>
		<p id="{id}-waiting" role="status">{copy.loading}</p>
	{:else if load === 'no-key'}
		<Notice title={copy.noKey.title} role="note"><p>{copy.noKey.detail}</p></Notice>
	{:else if load === 'failed' || !snapshot || !api}
		<SectionIssue
			title={copy.loadFailed.title}
			detail={copy.loadFailed.detail}
			retryLabel={copy.loadFailed.retry}
			onretry={start}
		/>
	{:else}
		{#if message}
			{#if message.kind === 'alert'}
				<Notice title={message.text} />
			{:else}
				<p class="said" role="status">{message.text}</p>
			{/if}
		{/if}

		{#if empty}
			<AddBroker {api} {brokers} first oncancel={closeAdd} onadded={added} />
		{:else}
			<section class="block" aria-labelledby="{id}-accounts">
				<div class="head">
					<h2 id="{id}-accounts">{copy.accounts.heading}</h2>
					{#if offered.length && !adding}
						<button type="button" class="button outline" bind:this={addButton} onclick={openAdd}
							>{copy.accounts.add}</button
						>
					{/if}
				</div>
				<AccountsLedger {api} {brokers} accounts={snapshot.accounts} onchanged={refresh} />
			</section>

			{#if adding}
				<AddBroker {api} brokers={offered} oncancel={closeAdd} onadded={added} />
			{/if}

			<HoldingsStrip {snapshot} />

			<section class="block" aria-labelledby="{id}-table">
				<h2 id="{id}-table">{copy.table.heading}</h2>
				<HoldingsLedger {snapshot} />
			</section>
		{/if}
	{/if}
</div>

<style>
	.holdings {
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

	.title {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3) var(--space-4);
	}

	h1 {
		font-stretch: var(--wdth-wide);
		font-weight: 800;
		font-size: 2rem;
		line-height: var(--leading-heading);
		letter-spacing: var(--tracking-heading);
	}

	.tag {
		border: 1.5px solid var(--ink);
		padding: 4px 8px;
		font-size: var(--text-sm);
		line-height: 1.2;
	}

	.lede {
		max-width: var(--measure);
	}

	.said {
		font-weight: 700;
	}

	.block {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}

	h2 {
		font-stretch: var(--wdth-heading);
		font-weight: 700;
		font-size: 1.375rem;
		line-height: 1.1;
		letter-spacing: var(--tracking-heading);
	}

	.skeleton-stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	@media (min-width: 768px) {
		h1 {
			font-size: 2.5rem;
		}
	}
</style>
