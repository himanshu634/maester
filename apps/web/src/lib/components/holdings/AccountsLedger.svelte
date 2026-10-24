<!--
	The brokers ledger ("Your brokers", at the foot of Holdings in D · final): each connected broker,
	where it stands in words, when its holdings were last read, and its one action, always outline:
	the nudge at the top holds the page's filled sign-in. A broker with no good sign-in has "Sign in
	to <broker>"; one that is signed in has "Read again". An account on
	a Settings connection (Dhan) never signs in here: it says so, and when Settings' token has
	expired its action is "Open Settings". Disconnect asks first. Below 768px each account stacks.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import { holdingsContent as copy } from '$lib/content/holdings';
	import { ApiError } from '$lib/documents/client';
	import type { HoldingsApi } from '$lib/holdings/client';
	import type { BrokerAccount, BrokerSummary } from '$lib/holdings/types';
	import {
		accountAction,
		readWords,
		settingsProvider,
		stateDetail,
		stateWords
	} from '$lib/holdings/view';
	import Ruler from '$lib/components/loading/Ruler.svelte';
	import BrokerDisconnectDialog from './BrokerDisconnectDialog.svelte';

	interface Props {
		api: HoldingsApi;
		brokers: BrokerSummary[];
		accounts: BrokerAccount[];
		/** After a read or a disconnect: read the snapshot again and say what changed. */
		onchanged: (said: string) => Promise<void>;
	}

	let { api, brokers, accounts, onchanged }: Props = $props();

	const id = $props.id();
	let busy = $state<Record<string, 'read' | 'sign-in' | 'remove' | undefined>>({});
	let problem = $state<Record<string, string | undefined>>({});
	let confirming = $state<BrokerAccount | null>(null);

	const brokerOf = (a: BrokerAccount) => brokers.find((b) => b.id === a.broker);
	const confirmingProvider = $derived(confirming ? settingsProvider(brokerOf(confirming)) : null);

	async function signIn(a: BrokerAccount) {
		busy[a.broker] = 'sign-in';
		problem[a.broker] = undefined;
		try {
			window.location.assign(await api.signInUrl(a.broker));
		} catch {
			problem[a.broker] = copy.errors.BROKER_UNAVAILABLE!(a.name);
			busy[a.broker] = undefined;
		}
	}

	/** Read again, or for a direct sign-in (Groww) sign in with the approved key and read. */
	async function read(a: BrokerAccount, direct = false) {
		busy[a.broker] = 'read';
		problem[a.broker] = undefined;
		try {
			const next = direct ? await api.session(a.broker) : await api.read(a.broker);
			await onchanged(
				next.errorCode
					? (copy.errors[next.errorCode]?.(a.name) ?? '')
					: copy.statuses.read(a.name, next.lastReadCount)
			);
		} catch (err) {
			problem[a.broker] =
				err instanceof ApiError && err.code === 'RATE_LIMITED'
					? copy.accounts.tooSoon
					: copy.accounts.readFailed(a.name);
		} finally {
			busy[a.broker] = undefined;
		}
	}

	async function remove() {
		const a = confirming;
		if (!a) return;
		busy[a.broker] = 'remove';
		try {
			await api.remove(a.broker);
			confirming = null;
			await onchanged(copy.statuses.disconnected(a.name));
		} catch {
			problem[a.broker] = copy.accounts.readFailed(a.name);
			confirming = null;
		} finally {
			busy[a.broker] = undefined;
		}
	}
</script>

<div class="ledger" role="table" aria-label={copy.accounts.heading}>
	<div class="row head" role="row">
		<span role="columnheader">{copy.accounts.columns.account}</span>
		<span role="columnheader">{copy.accounts.columns.state}</span>
		<span role="columnheader">{copy.accounts.columns.read}</span>
		<span role="columnheader"><span class="visually-hidden">Actions</span></span>
	</div>
	{#each accounts as a (a.broker)}
		{@const action = accountAction(a, brokerOf(a))}
		<div class="row" role="row">
			<div role="cell" class="cell">
				<span class="strong">{a.name}</span>
				<span class="muted small">{a.accountId ?? '—'}</span>
			</div>
			<div role="cell" class="cell">
				<span class={{ strong: a.state !== 'signed_in' }}>{stateWords(a)}</span>
				<span class="muted small">{stateDetail(a, brokerOf(a))}</span>
			</div>
			<div role="cell" class="cell num">{readWords(a)}</div>
			<div role="cell" class="cell actions">
				{#if action === 'settings'}
					<a class="button outline" href={resolve('/terminal/settings')}
						>{copy.accounts.openSettings}</a
					>
				{:else if action === 'sign_in'}
					<button
						type="button"
						class="button outline"
						disabled={busy[a.broker] !== undefined}
						onclick={() => signIn(a)}>{copy.accounts.signIn(a.name)}</button
					>
				{:else if action === 'direct'}
					<button
						type="button"
						class="button outline"
						disabled={busy[a.broker] !== undefined}
						aria-describedby={busy[a.broker] === 'read' ? `${id}-${a.broker}-reading` : undefined}
						onclick={() => read(a, true)}>{copy.accounts.readDirect(a.name)}</button
					>
				{:else}
					<button
						type="button"
						class="button outline"
						disabled={busy[a.broker] !== undefined}
						aria-describedby={busy[a.broker] === 'read' ? `${id}-${a.broker}-reading` : undefined}
						onclick={() => read(a)}>{copy.accounts.readAgain}</button
					>
				{/if}
				<button
					type="button"
					class="button outline"
					disabled={busy[a.broker] !== undefined}
					onclick={() => (confirming = a)}>{copy.accounts.disconnect}</button
				>
			</div>
			{#if busy[a.broker] === 'read'}
				<div class="wide" id="{id}-{a.broker}-reading">
					<p class="small">{copy.accounts.reading(a.name)}</p>
					<Ruler />
				</div>
			{/if}
			{#if problem[a.broker]}
				<p class="wide strong small" role="alert">{problem[a.broker]}</p>
			{/if}
		</div>
	{/each}
</div>

<BrokerDisconnectDialog
	open={confirming !== null}
	name={confirming?.name ?? ''}
	detail={confirmingProvider ? copy.dialog.settingsDetail(confirmingProvider) : copy.dialog.detail}
	busy={confirming ? busy[confirming.broker] === 'remove' : false}
	onconfirm={remove}
	onclose={() => (confirming = null)}
/>

<style>
	.ledger {
		border: var(--rule) solid var(--ink);
	}

	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-2);
		padding: var(--space-4);
	}

	.row + .row {
		border-top: var(--rule-thin) solid var(--ink-muted);
	}

	.head {
		display: none;
		font-size: var(--text-sm);
		color: var(--ink-muted);
	}

	.cell {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		font-size: 1rem;
		line-height: var(--leading-small);
	}

	.actions {
		flex-direction: row;
		flex-wrap: wrap;
		gap: var(--space-3);
		padding-top: var(--space-2);
	}

	.strong {
		font-weight: 700;
	}

	.small {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
	}

	.wide {
		grid-column: 1 / -1;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	@media (min-width: 768px) {
		.row {
			grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.6fr) minmax(0, 1fr) auto;
			align-items: center;
			gap: var(--space-2) var(--space-4);
		}

		.head {
			display: grid;
			border-bottom: var(--rule) solid var(--ink);
		}

		.head + .row {
			border-top: 0;
		}

		.actions {
			justify-content: flex-end;
			padding-top: 0;
		}
	}
</style>
