<script lang="ts">
	/**
	 * The four headline figures, each with the note that says what it covers. A spec list
	 * on a phone, two by two from 768px, one row from 1024px. A figure with no input is "—"
	 * with the reason read out, never a zero.
	 */
	import { terminalContent } from '$lib/content/terminal';
	import { inr } from '$lib/terminal/format';
	import { coverageNote, gainNote } from '$lib/terminal/overview';
	import type { Valuation } from '$lib/terminal/portfolio';

	interface Props {
		valuation: Valuation;
		cash: number;
	}

	let { valuation, cash }: Props = $props();

	interface Figure {
		label: string;
		/** Null when the figure is unknown; `reason` is then read out. */
		value: string | null;
		reason: string;
		note: string;
	}

	const labels = terminalContent.figures;
	let figures: Figure[] = $derived([
		{
			label: labels.knownValue,
			value: valuation.priced > 0 ? inr(valuation.knownValue) : null,
			reason: labels.unknownValue,
			note: labels.pricedOf(valuation.priced, valuation.count)
		},
		{ label: labels.cash, value: inr(cash), reason: '', note: labels.cashNote },
		{
			label: labels.gain,
			value: valuation.withCost > 0 ? inr(valuation.gain, { sign: true }) : null,
			reason: labels.unknownGain,
			note: gainNote(valuation)
		},
		{
			label: labels.coverage,
			value: `${valuation.priced} of ${valuation.count}`,
			reason: '',
			note: coverageNote(valuation)
		}
	]);
</script>

<dl class="figures">
	{#each figures as figure (figure.label)}
		<div class="cell">
			<dt>{figure.label}</dt>
			<dd>
				<span class="figure num">
					{#if figure.value === null}
						<span aria-hidden="true">—</span><span class="visually-hidden">{figure.reason}</span>
					{:else}
						{figure.value}
					{/if}
				</span>
				<span class="muted note">{figure.note}</span>
			</dd>
		</div>
	{/each}
</dl>

<style>
	.figures {
		margin: 0;
		border-top: var(--rule) solid var(--ink);
		border-bottom: var(--rule) solid var(--ink);
	}

	.cell {
		display: grid;
		grid-template-columns: 112px minmax(0, 1fr);
		gap: var(--space-4);
		padding: var(--space-3) 0;
		font-size: 1rem;
		line-height: var(--leading-small);
	}

	.cell + .cell {
		border-top: var(--rule-thin) solid var(--ink-muted);
	}

	dt {
		font-weight: 700;
	}

	dd {
		display: flex;
		flex-direction: column;
		margin: 0;
	}

	.figure {
		font-weight: 700;
		font-size: var(--text-lg);
	}

	.note {
		font-size: var(--text-sm);
	}

	@media (min-width: 768px) {
		.figures {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.cell {
			display: flex;
			flex-direction: column;
			gap: 6px;
			padding: var(--space-4) var(--space-5) 18px;
		}

		.cell + .cell {
			border-top: 0;
		}

		/* Two by two: a muted rule between the columns and between the rows. */
		.cell:nth-child(even) {
			border-left: var(--rule-thin) solid var(--ink-muted);
		}

		.cell:nth-child(n + 3) {
			border-top: var(--rule-thin) solid var(--ink-muted);
		}

		.cell:nth-child(odd) {
			padding-left: 0;
		}

		dt {
			font-weight: 400;
			font-size: var(--text-sm);
			color: var(--ink-muted);
		}

		dd {
			gap: 6px;
		}

		.figure {
			font-stretch: var(--wdth-heading);
			font-size: 2rem;
			line-height: 1.05;
			letter-spacing: var(--tracking-heading);
		}
	}

	@media (min-width: 1024px) {
		.figures {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}

		.cell:nth-child(n + 3) {
			border-top: 0;
		}

		.cell + .cell {
			padding-left: var(--space-5);
			border-left: var(--rule-thin) solid var(--ink-muted);
		}

		/* Scales with the viewport so four figures fit beside the rail at 1024px; 32px at 1440. */
		.figure {
			font-size: clamp(var(--text-lg), 2.2vw, 2rem);
		}
	}
</style>
