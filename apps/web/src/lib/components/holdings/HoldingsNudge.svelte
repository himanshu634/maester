<!--
	The nudge (D · final, canvas "Maester Broker Accounts"): one line at the top of Holdings while a
	broker is signed out but the holdings it read earlier are still on the page. The user's words: "a
	brief nudge instead of taking up an entire section of the screen", and "if we already have the
	data, we should not ask the user to update it again". Its first words are highlighted; the
	highlight draws across them once on load (240ms, none under reduced motion). "Update 2 brokers"
	opens the sign-ins in place, each broker with why and its one action, the first filled. Escape
	closes it and focus returns to the button. From 768px the list hangs under the line, over the
	page; below that it opens in the flow.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { holdingsContent as copy } from '$lib/content/holdings';
	import { ApiError } from '$lib/documents/client';
	import type { HoldingsApi } from '$lib/holdings/client';
	import type { BrokerAccount, BrokerSummary, HoldingsSnapshot } from '$lib/holdings/types';
	import { accountAction, needsSignIn, nudgeLine, stateWords } from '$lib/holdings/view';

	interface Props {
		api: HoldingsApi;
		brokers: BrokerSummary[];
		snapshot: HoldingsSnapshot;
		/** After a read: read the snapshot again and say what changed. */
		onchanged: (said: string) => Promise<void>;
	}

	let { api, brokers, snapshot, onchanged }: Props = $props();

	const id = $props.id();
	let open = $state(false);
	let busy = $state<string | null>(null);
	let problem = $state<string | null>(null);
	let toggle = $state<HTMLButtonElement>();

	const line = $derived(nudgeLine(snapshot));
	const out = $derived(needsSignIn(snapshot));
	const brokerOf = (a: BrokerAccount) => brokers.find((b) => b.id === a.broker);

	function what(a: BrokerAccount): string {
		return accountAction(a, brokerOf(a)) === 'read'
			? copy.nudge.whatRead
			: copy.nudge.whatRedirect(a.name);
	}

	async function signIn(a: BrokerAccount) {
		busy = a.broker;
		problem = null;
		try {
			window.location.assign(await api.signInUrl(a.broker));
		} catch {
			problem = copy.errors.BROKER_UNAVAILABLE!(a.name);
			busy = null;
		}
	}

	async function read(a: BrokerAccount) {
		busy = a.broker;
		problem = null;
		try {
			const next = await api.read(a.broker);
			await onchanged(
				next.errorCode
					? (copy.errors[next.errorCode]?.(a.name) ?? '')
					: copy.statuses.read(a.name, next.lastReadCount)
			);
		} catch (err) {
			problem =
				err instanceof ApiError && err.code === 'RATE_LIMITED'
					? copy.accounts.tooSoon
					: copy.accounts.readFailed(a.name);
		} finally {
			busy = null;
		}
	}

	async function close() {
		open = false;
		await tick();
		toggle?.focus();
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) {
			e.preventDefault();
			void close();
		}
	}
</script>

<svelte:window {onkeydown} />

{#if line}
	<div class="nudge">
		<div class={['bar', { open }]}>
			<p><mark>{line.lead}</mark> {line.rest}</p>
			<button
				bind:this={toggle}
				type="button"
				class={['button', 'outline', 'toggle', { pressed: open }]}
				aria-expanded={open}
				aria-controls="{id}-list"
				onclick={() => (open = !open)}
				>{line.button} <span aria-hidden="true">{open ? '−' : '+'}</span></button
			>
		</div>
		<div id="{id}-list" class="list" hidden={!open}>
			<ul aria-label={copy.nudge.listLabel}>
				{#each out as a, i (a.broker)}
					{@const action = accountAction(a, brokerOf(a))}
					<li>
						<div class="who">
							<span class="strong">{a.name}</span>
							<span class="muted small">{copy.nudge.why(stateWords(a), what(a))}</span>
						</div>
						{#if action === 'sign_in'}
							<button
								type="button"
								class={['button', { outline: i > 0 }]}
								disabled={busy !== null}
								onclick={() => signIn(a)}>{copy.accounts.signIn(a.name)}</button
							>
						{:else}
							<button
								type="button"
								class={['button', { outline: i > 0 }]}
								disabled={busy !== null}
								onclick={() => read(a)}>{copy.accounts.readAgain}</button
							>
						{/if}
					</li>
				{/each}
			</ul>
			{#if problem}<p class="strong small" role="alert">{problem}</p>{/if}
			<p class="muted small">{copy.nudge.back}</p>
		</div>
	</div>
{/if}

<style>
	.nudge {
		position: relative;
		z-index: 2;
	}

	.bar {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3) 0 0;
		/* One rule above; the strip's own top rule closes it, so two rules never stack. */
		border-top: var(--rule) solid var(--ink);
	}

	.bar p {
		margin: 0;
		font-size: 1rem;
		line-height: var(--leading-body);
	}

	/*
	 * The highlighter: a fill behind ink text, drawn once from the left on load. A block that grows
	 * (transform), not a gradient. The global reduced-motion rule leaves it simply there.
	 */
	mark {
		position: relative;
		isolation: isolate;
		padding: 0 var(--space-1);
		background: transparent;
		color: var(--ink);
		box-decoration-break: clone;
		-webkit-box-decoration-break: clone;
	}

	mark::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		background: var(--highlight);
		transform-origin: left center;
		animation: draw 240ms ease-out both;
	}

	@keyframes draw {
		from {
			transform: scaleX(0);
		}
		to {
			transform: scaleX(1);
		}
	}

	.toggle {
		align-self: stretch;
		gap: var(--space-2);
	}

	.toggle.pressed {
		background: var(--ink);
		color: var(--paper);
	}

	.list {
		margin-top: var(--space-3);
		border: var(--rule) solid var(--ink);
		background: var(--paper);
		padding: var(--space-2) var(--space-5) var(--space-3);
	}

	.list[hidden] {
		display: none;
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3) 0;
	}

	li + li {
		border-top: var(--rule-thin) solid var(--ink-muted);
	}

	.who {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.list p {
		margin: var(--space-2) 0 0;
		max-width: var(--measure);
	}

	.strong {
		font-weight: 700;
	}

	.small {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
	}

	@media (min-width: 768px) {
		.bar {
			flex-direction: row;
			align-items: center;
			gap: var(--space-6);
		}

		.bar p {
			flex: 1;
			min-width: 0;
			font-size: var(--text-base);
		}

		.toggle {
			align-self: center;
		}

		.list {
			position: absolute;
			right: 0;
			top: 100%;
			width: min(40rem, 100%);
		}

		li {
			flex-direction: row;
			align-items: center;
			gap: var(--space-4);
		}

		.who {
			flex: 1;
		}
	}
</style>
