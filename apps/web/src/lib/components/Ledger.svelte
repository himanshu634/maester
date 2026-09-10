<script lang="ts">
	import type { LedgerRow } from '$lib/content';

	interface Props {
		headingId: string;
		heading: string;
		intro: string;
		columns: readonly [string, string, string];
		rows: readonly LedgerRow[];
		note: string;
		numbered?: boolean;
	}

	let { headingId, heading, intro, columns, rows, note, numbered = false }: Props = $props();
</script>

<h2 id={headingId}>{heading}</h2>
<p class="measure intro">{intro}</p>

<svelte:element this={numbered ? 'ol' : 'ul'} class={['ledger', { numbered }]} aria-label={heading}>
	<li class="head" aria-hidden="true">
		{#if numbered}<span></span>{/if}
		<span class="muted">{columns[0]}</span>
		<span class="muted">{columns[1]}</span>
		<span class="muted">{columns[2]}</span>
	</li>
	{#each rows as row, i (row.title)}
		<li class="step">
			{#if numbered}<span class="num index">{i + 1}</span>{/if}
			<span class="title">{row.title}</span>
			<span class="action">{row.first}</span>
			<span class="muted keeps">{row.second}</span>
		</li>
	{/each}
</svelte:element>
<p class="muted note measure">{note}</p>

<style>
	h2 {
		font-stretch: var(--wdth-heading);
		font-weight: 700;
		font-size: var(--text-xl);
		line-height: var(--leading-heading);
		letter-spacing: var(--tracking-heading);
	}

	.intro {
		margin-top: var(--space-4);
	}

	.ledger {
		list-style: none;
		padding: 0;
		margin-top: var(--space-6);
		border: var(--rule) solid var(--ink);
	}

	.head {
		display: none;
	}

	.step {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-1) var(--space-3);
		padding: var(--space-4);
		border-bottom: var(--rule-thin) solid var(--ink-muted);
		font-size: 1rem;
		line-height: var(--leading-small);
	}

	.step:last-child {
		border-bottom: 0;
	}

	.index,
	.title {
		font-weight: 700;
		font-size: var(--text-md);
	}

	.numbered .step {
		grid-template-columns: var(--space-8) minmax(0, 1fr);
	}

	.numbered .action,
	.numbered .keeps {
		grid-column: 2;
	}

	.note {
		margin-top: var(--space-5);
		font-size: var(--text-sm);
	}

	@media (min-width: 768px) {
		h2 {
			font-size: var(--text-2xl);
		}

		.intro {
			margin-top: var(--space-5);
		}

		.ledger {
			margin-top: var(--space-8);
		}

		.head,
		.step {
			grid-template-columns: 240px minmax(0, 1fr) minmax(0, 1fr);
			gap: 0 var(--space-6);
		}

		.numbered .head,
		.numbered .step {
			grid-template-columns: 64px 240px minmax(0, 1fr) minmax(0, 1fr);
		}

		.head {
			display: grid;
			padding: var(--space-3) var(--space-5);
			border-bottom: var(--rule) solid var(--ink);
			font-size: var(--text-sm);
		}

		.step {
			padding: var(--space-5);
		}

		.action,
		.keeps,
		.numbered .action,
		.numbered .keeps {
			grid-column: auto;
		}
	}
</style>
