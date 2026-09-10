<script lang="ts">
	interface Props {
		heading: string;
		tag: string;
		label: string;
		value: string;
		meta: string;
		rows: readonly { term: string; detail: string }[];
	}

	let { heading, tag, label, value, meta, rows }: Props = $props();
</script>

<figure class="trace" aria-label={heading}>
	<figcaption class="caption">
		<span class="title">{heading}</span>
		<span class="tag">{tag}</span>
	</figcaption>
	<div class="ledger">
		<div class="fact">
			<span class="label">{label}</span>
			<span class="value">{value}</span>
			<span class="muted meta">{meta}</span>
		</div>
		{#each rows as row, i (row.term)}
			<div class="row" style:--step={i + 1}>
				<span class="muted">{row.term}</span>
				<span>{row.detail}</span>
			</div>
		{/each}
	</div>
</figure>

<style>
	.trace {
		margin: 0;
		border-top: var(--rule) solid var(--ink);
		padding-top: var(--space-6);
	}

	.caption {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3) var(--space-6);
	}

	.title {
		font-stretch: var(--wdth-heading);
		font-weight: 700;
		font-size: var(--text-md);
	}

	.tag {
		border: 1.5px solid var(--ink);
		padding: var(--space-1) var(--space-2);
		font-size: var(--text-sm);
	}

	.ledger {
		margin-top: var(--space-4);
		border: var(--rule) solid var(--ink);
	}

	.fact {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: var(--space-1) var(--space-4);
		padding: var(--space-4) var(--space-4);
		border-bottom: var(--rule-thin) solid var(--ink-muted);
		font-size: var(--text-md);
	}

	.label,
	.value {
		font-weight: 700;
	}

	.value {
		text-align: right;
	}

	.meta {
		grid-column: 1 / -1;
		font-size: var(--text-sm);
	}

	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0 var(--space-4);
		padding: var(--space-3) var(--space-4);
		border-bottom: var(--rule-thin) solid var(--ink-muted);
		font-size: var(--text-sm);
		line-height: var(--leading-small);
		/* The page's one load moment: each status line resolves in turn. */
		animation: resolve var(--motion-reveal) steps(1, end) both;
		animation-delay: calc(var(--motion-step) * var(--step) + 200ms);
	}

	.row:last-child {
		border-bottom: 0;
	}

	@keyframes resolve {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@media (min-width: 768px) {
		.fact {
			padding: var(--space-4) var(--space-5);
		}

		.row {
			grid-template-columns: 220px minmax(0, 1fr);
			padding: var(--space-3) var(--space-5);
			font-size: 1rem;
		}
	}

	@media (min-width: 1024px) {
		.fact {
			grid-template-columns: 340px 180px minmax(0, 1fr);
		}

		.value {
			padding-right: var(--space-6);
		}

		.meta {
			grid-column: auto;
			font-size: var(--text-md);
		}
	}
</style>
