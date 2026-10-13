<!--
	"The stock and the business": one sentence filled in by rule, four headline figures and the
	last year's closes. The prices are the investor's own Dhan closes; the business figures are
	the newest year read. An unknown figure is "—" with its reason, never 0. With no price there
	is no chart. A failed price read is a section issue for the prices only: the business figures
	still show.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import { researchContent } from '$lib/content/research';
	import { niceDomain } from '$lib/market-mood/chart';
	import type { Summary } from '$lib/research/summary';
	import type { CompanyStock } from '$lib/research/types';
	import { inr, price } from '$lib/terminal/format';
	import SectionIssue from '$lib/components/errors/SectionIssue.svelte';
	import MoodChart from '$lib/components/market-mood/MoodChart.svelte';
	import RangeRuler from './RangeRuler.svelte';

	interface Props {
		summary: Summary;
		stock: CompanyStock | null;
		name: string;
		/** The prices did not load. */
		failed: boolean;
		onretry: () => void;
		/** The prices are being asked for again. */
		retrying?: boolean;
		/** What the last retry came to, said politely. */
		outcome?: string;
	}

	let { summary, stock, name, failed, onretry, retrying = false, outcome = '' }: Props = $props();

	const id = $props.id();
	const copy = researchContent.summary;
	const issue = researchContent.company.stockFailed;

	let chart = $derived(
		stock?.state === 'ok' && stock.series.length > 1 && stock.last && stock.low && stock.high
			? {
					points: stock.series,
					last: stock.last,
					low: stock.low,
					high: stock.high
				}
			: null
	);
</script>

<section class="summary" aria-labelledby="{id}-summary">
	<h2 id="{id}-summary">{copy.heading}</h2>
	{#if summary.sentence}<p class="sentence">{summary.sentence}</p>{/if}

	{#if failed}
		<SectionIssue
			title={issue.title}
			detail={issue.detail}
			retryLabel={issue.retry}
			{onretry}
			busy={retrying ? issue.busy : null}
			{outcome}
		/>
	{/if}

	<div class="strip">
		<dl class="figures">
			{#each summary.figures as f, index (f.label)}
				<div class={['cell', { range: index === 1 }]}>
					<dt class="muted">{f.label}</dt>
					<dd>
						<span class="figure num">
							{#if f.value === null}
								<span aria-hidden="true">—</span>
								<!-- The note under it says why, unless the figure has a note of its own. -->
								{#if f.note}<span class="visually-hidden">{f.reason}</span>{/if}
							{:else}
								{f.value}
							{/if}
						</span>
						{#if f.change}<span class="change num">{f.change}</span>{/if}
						{#if f.rulerPct !== null}<RangeRuler pct={f.rulerPct} />{/if}
						{#if f.settingsLink}
							<span class="muted note">
								{copy.connect.before}
								<a href={resolve('/terminal/settings')}>{copy.settings}</a>
								{copy.connect.after}
							</span>
						{:else if f.note ?? f.reason}
							<span class="muted note">{f.note ?? f.reason}</span>
						{/if}
					</dd>
				</div>
			{/each}
		</dl>
	</div>

	{#if chart}
		<div class="chart">
			<div class="chart-head">
				<h3>{copy.chart.heading}</h3>
				<p class="muted source">{copy.chart.source}</p>
			</div>
			<MoodChart
				points={chart.points}
				domain={niceDomain(chart.points.map((p) => p.value))}
				label={copy.chart.label(
					name,
					price(chart.low.value),
					price(chart.high.value),
					price(chart.last.value)
				)}
				format={price}
				axisFormat={(v) => inr(v)}
				gutter={72}
				todayLabel={copy.chart.today(price(chart.last.value))}
				lowLabel={(v, day) => copy.chart.low(price(v), day)}
				highLabel={(v, day) => copy.chart.high(price(v), day)}
				withYear
				valueHeader={copy.chart.value}
			/>
		</div>
	{/if}
</section>

<style>
	.summary {
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

	.sentence {
		max-width: var(--measure);
	}

	.strip {
		container-type: inline-size;
	}

	/* A list on a phone, two by two from 36rem, four in a row once each figure fits on one line. */
	.figures {
		margin: 0;
		border-top: var(--rule) solid var(--ink);
		border-bottom: var(--rule) solid var(--ink);
	}

	.cell {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
		padding: var(--space-3) 0 var(--space-4);
	}

	.cell + .cell {
		border-top: var(--rule-thin) solid var(--ink-muted);
	}

	dt {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
	}

	dd {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin: 0;
		min-width: 0;
	}

	.figure {
		font-stretch: var(--wdth-heading);
		font-weight: 700;
		font-size: var(--text-xl);
		line-height: 1.05;
		letter-spacing: var(--tracking-heading);
	}

	/* The range is two prices: kept smaller so it stays on one line. */
	.range .figure {
		font-size: var(--text-lg);
		white-space: nowrap;
	}

	.change {
		font-weight: 700;
		font-size: 1rem;
		line-height: var(--leading-small);
	}

	.note {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
	}

	.chart {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
		padding-top: var(--space-2);
	}

	.chart-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-1) var(--space-4);
	}

	h3 {
		font-weight: 700;
		font-size: 1.0625rem;
		line-height: 1.2;
	}

	.source {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
	}

	@container (min-width: 36rem) {
		.figures {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.cell {
			padding: var(--space-4) var(--space-5) 18px;
		}

		.cell + .cell {
			border-top: 0;
		}

		.cell:nth-child(even) {
			border-left: var(--rule-thin) solid var(--ink-muted);
		}

		.cell:nth-child(odd) {
			padding-left: 0;
		}

		.cell:nth-child(n + 3) {
			border-top: var(--rule-thin) solid var(--ink-muted);
		}

		.figure {
			font-size: 2rem;
		}
	}

	@container (min-width: 60rem) {
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
	}

	@media (min-width: 1024px) {
		.sentence {
			font-size: 1.1875rem;
		}
	}
</style>
