<script lang="ts">
	/**
	 * Share of priced value by sector, largest first. The bars are drawing only; the label
	 * and percentage carry the figure. The unknown bucket is a dashed outline, last.
	 */
	import { terminalContent } from '$lib/content/terminal';
	import { percent } from '$lib/terminal/format';
	import { allocationNote } from '$lib/terminal/overview';
	import type { Valuation } from '$lib/terminal/portfolio';

	interface Props {
		headingId: string;
		valuation: Valuation;
	}

	let { headingId, valuation }: Props = $props();

	// The largest share draws a full-width bar; the rest scale against it.
	let largest = $derived(Math.max(0, ...valuation.sectors.map((s) => s.share)));
</script>

<section aria-labelledby={headingId}>
	<h2 id={headingId}>{terminalContent.allocation.heading}</h2>
	<ul class="bars">
		{#each valuation.sectors as sector (sector.label)}
			<li class={['bar-row', { unknown: sector.unknown }]}>
				<span class="label">{sector.label}</span>
				<span class="track" aria-hidden="true">
					<span class="bar" style:width="{largest > 0 ? (sector.share / largest) * 100 : 0}%"
					></span>
				</span>
				<span class="share num">{percent(sector.share)}</span>
			</li>
		{/each}
	</ul>
	<p class="muted note">{allocationNote(valuation)}</p>
</section>

<style>
	section {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		min-width: 0;
	}

	h2 {
		font-stretch: var(--wdth-heading);
		font-weight: 700;
		font-size: var(--text-lg);
		line-height: var(--leading-heading);
		letter-spacing: var(--tracking-heading);
	}

	.bars {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.bar-row {
		display: grid;
		grid-template-columns: 118px minmax(0, 1fr) 56px;
		gap: var(--space-3);
		align-items: center;
		padding: 10px 0;
		font-size: 1rem;
		line-height: var(--leading-small);
	}

	.bar-row + .bar-row {
		border-top: var(--rule-thin) solid var(--ink-muted);
	}

	.label {
		min-width: 0;
	}

	.unknown .label {
		color: var(--ink-muted);
	}

	.track {
		display: block;
		height: 12px;
	}

	.bar {
		display: block;
		height: 100%;
		background: var(--ink);
	}

	.unknown .bar {
		background: transparent;
		border: 1.5px dashed var(--ink);
	}

	.share {
		text-align: right;
	}

	.note {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
	}

	@media (min-width: 768px) {
		/* 170px as in frame C1, but never so wide that the bars vanish beside the table at 1024px. */
		.bar-row {
			grid-template-columns: min(170px, 40%) minmax(0, 1fr) 56px;
		}
	}
</style>
