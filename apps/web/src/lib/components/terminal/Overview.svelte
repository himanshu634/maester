<script lang="ts">
	/**
	 * The portfolio overview, as one page body for both demo routes: the title block, what
	 * is due this week, the headline figures, holdings beside allocation, then research.
	 * Everything is computed from the demo portfolio passed in; nothing here is real.
	 */
	import { terminalContent } from '$lib/content/terminal';
	import { dueItems } from '$lib/terminal/due';
	import { quietChecks, WEEK, type Demo } from '$lib/terminal/fixture';
	import { valuePortfolio } from '$lib/terminal/portfolio';
	import TerminalShell from './TerminalShell.svelte';
	import DuePanel from './DuePanel.svelte';
	import FigureStrip from './FigureStrip.svelte';
	import HoldingsTable from './HoldingsTable.svelte';
	import SectorBars from './SectorBars.svelte';
	import ResearchUpdates from './ResearchUpdates.svelte';

	interface Props {
		data: Demo;
		path: '/terminal/demo' | '/terminal/demo/quiet';
	}

	let { data, path }: Props = $props();

	const noteId = 'read-only-note';
	let valuation = $derived(valuePortfolio(data.holdings));
	let items = $derived(dueItems(valuation, { ...WEEK, limit: data.limit }));
	let checks = $derived(items.length === 0 ? quietChecks(valuation, data.limit) : []);
</script>

<TerminalShell demo overview={path} portfolio={terminalContent.workspace}>
	<div class="overview">
		<div class="title">
			<div class="name-row">
				<h1>{terminalContent.workspace}</h1>
				<div class="tags">
					<span class="tag">{terminalContent.snapshotTag}</span>
					<span class="tag">{terminalContent.demoTag}</span>
				</div>
			</div>
			<p class="muted as-of">{data.asOf}</p>
			<p class="muted note" id={noteId}>{terminalContent.readOnlyNote}</p>
		</div>
		<div class="update">
			<button class="button outline" type="button" disabled aria-describedby={noteId}>
				{terminalContent.actions.updateHoldings}
			</button>
		</div>

		<DuePanel headingId="due-heading" {noteId} {items} {valuation} limit={data.limit} {checks} />

		<FigureStrip {valuation} cash={data.cash} />

		<div class="pair">
			<HoldingsTable headingId="holdings-heading" {valuation} />
			<SectorBars headingId="allocation-heading" {valuation} />
		</div>

		<ResearchUpdates headingId="research-heading" items={data.research} />
	</div>
</TerminalShell>

<style>
	.overview {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-7);
	}

	.title {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}

	.name-row {
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

	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.tag {
		border: 1.5px solid var(--ink);
		padding: var(--space-1) var(--space-2);
		font-size: var(--text-sm);
		line-height: 1.2;
		white-space: nowrap;
	}

	.as-of,
	.note {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
	}

	/* On a phone the one page-level action closes the page, as frame C2 shows. */
	.update {
		order: 1;
	}

	.update .button {
		width: 100%;
		white-space: nowrap;
	}

	.pair {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-8);
	}

	@media (min-width: 768px) {
		.overview {
			grid-template-columns: minmax(0, 1fr) auto;
			gap: var(--space-8) var(--space-6);
		}

		.overview > :global(*) {
			grid-column: 1 / -1;
		}

		.overview > .title {
			grid-column: 1;
		}

		.overview > .update {
			order: 0;
			grid-column: 2;
			align-self: end;
		}

		.name-row {
			flex-direction: row;
			flex-wrap: wrap;
			align-items: center;
			gap: var(--space-3) var(--space-4);
		}

		h1 {
			font-size: var(--text-2xl);
		}

		.as-of {
			font-size: 1rem;
		}

		.update .button {
			width: auto;
		}
	}

	@media (min-width: 1024px) {
		.pair {
			grid-template-columns: minmax(0, 1.65fr) minmax(0, 1fr);
			gap: var(--space-10);
		}
	}
</style>
