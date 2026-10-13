<!--
	One reading opened (canvas F3): its value, how it moved, where it sits among its own 2 years,
	the 2-year line with a table view, and what it is, what it adds to the mood and where it came
	from. A missing value is "—" with the reason.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { marketMoodContent as copy } from '$lib/content/market-mood';
	import type { Fetcher } from '$lib/documents/client';
	import { niceDomain } from '$lib/market-mood/chart';
	import { marketMoodApi } from '$lib/market-mood/client';
	import type { ReadingDetail, ReadingKey } from '$lib/market-mood/types';
	import {
		formatPrevious,
		formatValue,
		inMoodLine,
		rankSentence,
		sourceLine
	} from '$lib/market-mood/view';
	import SectionIssue from '$lib/components/errors/SectionIssue.svelte';
	import Hatch from '$lib/components/loading/Hatch.svelte';
	import MoodChart from './MoodChart.svelte';

	interface Props {
		key: ReadingKey;
	}

	let { key }: Props = $props();

	const id = $props.id();
	const fetcher: Fetcher = (url, init) => fetch(url, init);
	const api = marketMoodApi(fetcher);

	let load = $state<'loading' | 'failed' | 'ready'>('loading');
	let detail = $state.raw<ReadingDetail | null>(null);

	async function start() {
		load = 'loading';
		try {
			detail = await api.reading(key);
			load = 'ready';
		} catch {
			load = 'failed';
		}
	}

	onMount(start);

	let words = $derived(copy.readings[key]);
	let reading = $derived(detail?.reading ?? null);
	let series = $derived(detail?.series ?? []);
	let domain = $derived(niceDomain(series.map((p) => p.value)));
	/** Formats an axis or table figure in the reading's own unit. */
	let format = $derived((value: number) =>
		reading ? formatValue({ ...reading, value }) : String(value)
	);
	let previous = $derived(reading ? formatPrevious(reading) : null);
	let rank = $derived(reading ? rankSentence(reading) : null);
	let latestDay = $derived(series.at(-1)?.day ?? null);
</script>

<div class="reading-page">
	<a href={resolve('/terminal/market-mood')}>{copy.backToMood}</a>

	<section class="head" aria-labelledby="{id}-title">
		<div class="title-row">
			<h1 id="{id}-title">{words.name}</h1>
			{#if reading}<span class="tag">{copy.families[reading.family].title}</span>{/if}
		</div>
		{#if load === 'loading'}
			<div aria-busy="true" aria-describedby="{id}-waiting" class="skeleton">
				<div aria-hidden="true" class="skeleton-body">
					<Hatch width="12rem" height="4.5rem" />
					<Hatch width="min(40rem, 100%)" height="1.5rem" />
					<Hatch height="13.75rem" />
				</div>
			</div>
			<p id="{id}-waiting" role="status">{copy.reading.loading}</p>
		{:else if load === 'failed' || !reading}
			<SectionIssue
				title={copy.reading.loadFailed.title}
				detail={copy.reading.loadFailed.detail}
				retryLabel={copy.reading.loadFailed.retry}
				onretry={start}
			/>
		{:else}
			<p class="figure">
				<span class="value num">{formatValue(reading)}</span>
				{#if previous}<span class="previous num">{previous}</span>{/if}
			</p>
			<p class="lede">
				{#if rank}{rank}.{/if}
				{words.measures}
			</p>
		{/if}
	</section>

	{#if load === 'ready' && reading}
		<div class="body">
			<section class="history" aria-labelledby="{id}-history">
				<h2 id="{id}-history">{copy.reading.chartHeading}</h2>
				{#if series.length > 0}
					<MoodChart
						points={series}
						{domain}
						label={copy.reading.chartLabel(
							words.name,
							format(domain[0]),
							format(domain[1]),
							formatValue(reading)
						)}
						{format}
						todayLabel={copy.reading.today(format(series[series.length - 1]!.value))}
						withYear
						valueHeader={copy.reading.value}
					/>
				{:else}
					<p class="muted note">{copy.reading.empty}</p>
				{/if}
			</section>

			<section class="about" aria-labelledby="{id}-about">
				<h2 id="{id}-about">{copy.reading.about}</h2>
				<dl>
					<div>
						<dt>{copy.reading.terms.what}</dt>
						<dd>{words.measures}</dd>
					</div>
					<div>
						<dt>{copy.reading.terms.inMood}</dt>
						<dd>{inMoodLine(reading).text}</dd>
					</div>
					<div>
						<dt>{copy.reading.terms.from}</dt>
						<dd>{sourceLine(reading, latestDay)}</dd>
					</div>
					<div>
						<dt>{copy.reading.terms.history}</dt>
						<dd>{copy.reading.history}</dd>
					</div>
				</dl>
			</section>
		</div>
	{/if}
</div>

<style>
	.reading-page {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-8);
		min-width: 0;
	}

	.reading-page > * {
		align-self: stretch;
	}

	.reading-page > a {
		align-self: flex-start;
	}

	.head {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.title-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}

	h1 {
		font-stretch: var(--wdth-wide);
		font-weight: 800;
		font-size: 2rem;
		line-height: var(--leading-heading);
		letter-spacing: var(--tracking-heading);
	}

	h2 {
		font-stretch: var(--wdth-heading);
		font-weight: 700;
		font-size: var(--text-lg);
		line-height: var(--leading-heading);
		letter-spacing: var(--tracking-heading);
	}

	.tag {
		border: 1.5px solid var(--ink);
		padding: var(--space-1) var(--space-2);
		font-size: var(--text-sm);
		line-height: 1.2;
		white-space: nowrap;
	}

	.figure {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-2) var(--space-5);
	}

	.value {
		font-stretch: var(--wdth-wide);
		font-weight: 800;
		font-size: clamp(3rem, 8vw, 4.5rem);
		line-height: 1;
	}

	.previous {
		font-size: var(--text-md);
	}

	.lede {
		max-width: var(--measure);
	}

	.note {
		font-size: var(--text-sm);
	}

	.body {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-10);
		align-items: start;
	}

	.history,
	.about {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}

	dl {
		margin: 0;
		border-top: var(--rule) solid var(--ink);
		border-bottom: var(--rule) solid var(--ink);
	}

	dl div {
		display: grid;
		grid-template-columns: 7.5rem minmax(0, 1fr);
		gap: var(--space-4);
		padding: var(--space-3) 0;
	}

	dl div + div {
		border-top: var(--rule-thin) solid var(--ink-muted);
	}

	dt {
		font-weight: 700;
		font-size: 1rem;
		line-height: var(--leading-small);
	}

	dd {
		margin: 0;
		font-size: 1rem;
		line-height: var(--leading-small);
	}

	.skeleton-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	@media (min-width: 768px) {
		h1 {
			font-size: var(--text-2xl);
		}
	}

	@media (min-width: 1024px) {
		.body {
			grid-template-columns: minmax(0, 1fr) 27.5rem;
			gap: var(--space-12);
		}
	}
</style>
