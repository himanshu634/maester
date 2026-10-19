<!--
	The figure strip (FigureStrip's rules): known value, cost, unrealized gain and accounts, each
	with a note saying what it covers. A spec list on a phone, two by two from 768px, one row from
	1024px. An unknown figure is "—" with the reason read out. Direction is a sign, never a colour.
-->
<script lang="ts">
	import { holdingsContent as copy } from '$lib/content/holdings';
	import { rupees } from '$lib/holdings/format';
	import type { HoldingsSnapshot } from '$lib/holdings/types';

	interface Props {
		snapshot: HoldingsSnapshot;
	}

	let { snapshot }: Props = $props();

	const t = $derived(snapshot.totals);
	const signedIn = $derived(snapshot.accounts.filter((a) => a.state === 'signed_in').length);
	const cells = $derived([
		{
			label: copy.strip.knownValue,
			value: t.knownValue ? rupees(t.knownValue) : null,
			note: copy.strip.knownValueNote(t.priced, t.count)
		},
		{
			label: copy.strip.cost,
			value: t.cost ? rupees(t.cost) : null,
			note: copy.strip.costNote(t.costed, t.count)
		},
		{
			label: copy.strip.gain,
			value: t.unrealizedGain ? rupees(t.unrealizedGain, { sign: true }) : null,
			note: copy.strip.gainNote(t.gainCovers)
		},
		{
			label: copy.strip.accounts,
			value: `${snapshot.accounts.length}`,
			note: copy.strip.accountsNote(signedIn, snapshot.accounts.length)
		}
	]);
</script>

<dl class="strip" aria-label={copy.strip.label}>
	{#each cells as c (c.label)}
		<div class="cell">
			<dt>{c.label}</dt>
			<dd class="figure num">
				{#if c.value}{c.value}{:else}<span aria-hidden="true">—</span><span class="visually-hidden"
						>{copy.strip.unknown}</span
					>{/if}
			</dd>
			<dd class="note">{c.note}</dd>
		</div>
	{/each}
</dl>

<style>
	.strip {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		margin: 0;
		border-top: var(--rule) solid var(--ink);
		border-bottom: var(--rule) solid var(--ink);
	}

	.cell {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-4) 0;
		min-width: 0;
	}

	.cell + .cell {
		border-top: var(--rule-thin) solid var(--ink-muted);
	}

	dt {
		font-size: var(--text-sm);
		color: var(--ink-muted);
	}

	dd {
		margin: 0;
	}

	.figure {
		font-stretch: var(--wdth-heading);
		font-weight: 700;
		font-size: 1.75rem;
		line-height: 1.05;
		letter-spacing: var(--tracking-heading);
		overflow-wrap: anywhere;
	}

	.note {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
		color: var(--ink-muted);
	}

	@media (min-width: 768px) {
		.strip {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.cell {
			padding: var(--space-4) var(--space-5);
		}

		.cell + .cell {
			border-top: 0;
		}

		.cell:nth-child(even) {
			border-left: var(--rule-thin) solid var(--ink-muted);
		}

		.cell:nth-child(n + 3) {
			border-top: var(--rule-thin) solid var(--ink-muted);
		}
	}

	@media (min-width: 1024px) {
		.strip {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}

		.cell:nth-child(n + 2) {
			border-left: var(--rule-thin) solid var(--ink-muted);
		}

		.cell:nth-child(n + 3) {
			border-top: 0;
		}
	}
</style>
