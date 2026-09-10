<script lang="ts">
	import type { ComparisonRow } from '$lib/content';

	interface Props {
		headingId: string;
		heading: string;
		intro: string;
		columns: readonly [string, string];
		rows: readonly ComparisonRow[];
	}

	let { headingId, heading, intro, columns, rows }: Props = $props();
</script>

<h2 id={headingId}>{heading}</h2>
<p class="measure intro">{intro}</p>

<div class="table" role="table" aria-label={heading}>
	<div class="row head" role="row">
		<span role="columnheader" class="muted">{columns[0]}</span>
		<span role="columnheader">{columns[1]}</span>
	</div>
	{#each rows as row (row.before)}
		<div class="row" role="row">
			<span role="cell" class="muted before">{row.before}</span>
			<span role="cell" class="after">{row.after}</span>
		</div>
	{/each}
</div>

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

	.table {
		margin-top: var(--space-6);
		border: var(--rule) solid var(--ink);
	}

	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-2) var(--space-6);
		padding: var(--space-4);
		border-bottom: var(--rule-thin) solid var(--ink-muted);
		font-size: 1rem;
		line-height: var(--leading-small);
	}

	.row:last-child {
		border-bottom: 0;
	}

	.head {
		border-bottom: var(--rule) solid var(--ink);
		font-size: var(--text-sm);
		font-weight: 700;
	}

	.after {
		font-weight: 700;
	}

	@media (min-width: 768px) {
		h2 {
			font-size: var(--text-2xl);
		}

		.intro {
			margin-top: var(--space-5);
		}

		.table {
			margin-top: var(--space-8);
		}

		.row {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			padding: var(--space-5);
		}

		.head {
			padding: var(--space-3) var(--space-5);
		}
	}
</style>
