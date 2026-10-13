<!--
	The Market mood page ("A+B · final"): the band word, score and ruler; the 10 readings in their
	4 families, each with its source and day; the mood's last 12 months and how it is worked out.
	Context for keeping to your own allocation, never advice. While the page stays open it reads
	the mood again every 10 minutes, but not while the tab is hidden.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { marketMoodContent as copy } from '$lib/content/market-mood';
	import type { Fetcher } from '$lib/documents/client';
	import { marketMoodApi } from '$lib/market-mood/client';
	import type { MarketMood } from '$lib/market-mood/types';
	import {
		bandLabel,
		byFamily,
		dayMonth,
		dayTag,
		fetchNotice,
		headLine
	} from '$lib/market-mood/view';
	import Notice from '$lib/components/auth/Notice.svelte';
	import SectionIssue from '$lib/components/errors/SectionIssue.svelte';
	import Hatch from '$lib/components/loading/Hatch.svelte';
	import MoodChart from './MoodChart.svelte';
	import MoodRuler from './MoodRuler.svelte';
	import ReadingRow from './ReadingRow.svelte';

	/** How often an open page reads the mood again. The worker refreshes every 30 minutes. */
	const RELOAD_MS = 10 * 60 * 1000;

	const id = $props.id();
	const fetcher: Fetcher = (url, init) => fetch(url, init);
	const api = marketMoodApi(fetcher);

	let load = $state<'loading' | 'failed' | 'ready'>('loading');
	let mood = $state.raw<MarketMood | null>(null);
	let hidden = $state(false);

	async function start() {
		if (!mood) load = 'loading';
		try {
			mood = await api.mood();
			load = 'ready';
		} catch {
			// A failed background read keeps the mood already on screen.
			if (!mood) load = 'failed';
		}
	}

	onMount(() => {
		hidden = document.hidden;
		start();
	});

	// Read again after a while; never while the tab is hidden. Re-arms after each read.
	$effect(() => {
		if (hidden || load !== 'ready' || !mood) return;
		const timer = window.setTimeout(start, RELOAD_MS);
		return () => window.clearTimeout(timer);
	});

	let notice = $derived(mood ? fetchNotice(mood) : null);
	let families = $derived(mood ? byFamily(mood.readings) : []);
	let tag = $derived(mood ? dayTag(mood) : null);
	let lowDay = $derived.by(() => {
		if (!mood || mood.history.length === 0) return null;
		const low = mood.history.reduce((a, b) => (b.score < a.score ? b : a));
		return { score: low.score, day: dayMonth(low.day) };
	});
</script>

<svelte:document onvisibilitychange={() => (hidden = document.hidden)} />

<div class="mood-page">
	{#if load === 'loading'}
		<h1>{copy.heading}</h1>
		<div class="skeleton" aria-busy="true" aria-describedby="{id}-waiting">
			<div aria-hidden="true" class="skeleton-head">
				<Hatch width="min(26rem, 80%)" height="5rem" />
				<Hatch width="min(40rem, 100%)" height="1.5rem" />
				<Hatch width="min(54rem, 100%)" height="3.75rem" />
			</div>
			{#each [1, 2, 3, 4] as block (block)}
				<div aria-hidden="true" class="skeleton-family">
					<Hatch width="10rem" height="1.5rem" />
					<Hatch height="5.5rem" />
					<Hatch height="5.5rem" />
				</div>
			{/each}
		</div>
		<p class="waiting" id="{id}-waiting" role="status">{copy.loading}</p>
	{:else if load === 'failed' || !mood}
		<h1>{copy.heading}</h1>
		<SectionIssue
			title={copy.loadFailed.title}
			detail={copy.loadFailed.detail}
			retryLabel={copy.loadFailed.retry}
			onretry={start}
		/>
	{:else}
		<section class="head" aria-labelledby="{id}-title">
			<div class="title-row">
				<h1 id="{id}-title">{copy.heading}</h1>
				{#if tag}<span class="tag">{tag}</span>{/if}
			</div>
			{#if mood.score !== null && mood.band !== null}
				<p class="verdict">
					<span class="band">{bandLabel(mood.band)}</span>
					<span class="score num">{copy.ofHundred(mood.score)}</span>
				</p>
			{:else if mood.latestSession !== null}
				<p class="no-mood">{copy.noMood}</p>
			{/if}
			<p class="head-line">{headLine(mood)}</p>
			<MoodRuler score={mood.score} />
		</section>

		{#if notice}
			<Notice title={notice.title} role="note">
				<p>{notice.detail}</p>
				{#if notice.action}
					<a href={resolve('/terminal/settings')}>{notice.action.label}</a>
				{/if}
			</Notice>
		{/if}

		<section class="readings" aria-labelledby="{id}-readings">
			<div class="section-head">
				<h2 id="{id}-readings">{copy.readingsHeading}</h2>
				<p class="muted lede">{copy.readingsLede}</p>
			</div>
			{#each families as group (group.family)}
				<section class="family" aria-labelledby="{id}-{group.family}">
					<div class="family-head">
						<h3 id="{id}-{group.family}">{copy.families[group.family].title}</h3>
						<p class="muted">{copy.families[group.family].blurb}</p>
					</div>
					<ul class="rows">
						{#each group.readings as reading (reading.key)}
							<ReadingRow {reading} latestSession={mood.latestSession} />
						{/each}
					</ul>
				</section>
			{/each}
		</section>

		<div class="foot">
			<section class="history" aria-labelledby="{id}-history">
				<h2 id="{id}-history">{copy.chart.heading}</h2>
				{#if mood.history.length > 0 && lowDay}
					<MoodChart
						points={mood.history.map((h) => ({ day: h.day, value: h.score }))}
						domain={[0, 100]}
						bands
						label={copy.chart.label(
							mood.history[0]!.score,
							mood.history[mood.history.length - 1]!.score,
							lowDay.score,
							lowDay.day
						)}
						format={(v) => String(Math.round(v))}
						todayLabel={copy.chart.today(mood.history[mood.history.length - 1]!.score)}
						lowLabel={(v, day) => copy.chart.lowest(v, day)}
						valueHeader={copy.chart.mood}
					/>
					{#if mood.atOrBelowShare !== null}
						<p class="muted note">{copy.chart.atOrBelow(mood.atOrBelowShare)}</p>
					{/if}
				{:else}
					<p class="muted note">{copy.chart.empty}</p>
				{/if}
			</section>

			<section class="method" aria-labelledby="{id}-method">
				<h2 id="{id}-method">{copy.method.heading}</h2>
				<dl>
					{#each copy.method.items as item (item.term)}
						<div>
							<dt>{item.term}</dt>
							<dd>{item.detail}</dd>
						</div>
					{/each}
				</dl>
				<p class="muted note">{copy.method.survivorship}</p>
			</section>
		</div>
	{/if}
</div>

<style>
	.mood-page {
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
		min-width: 0;
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

	h3 {
		font-stretch: var(--wdth-heading);
		font-weight: 700;
		font-size: var(--text-md);
		line-height: var(--leading-heading);
		letter-spacing: var(--tracking-heading);
	}

	.head {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.title-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}

	.tag {
		border: 1.5px solid var(--ink);
		padding: var(--space-1) var(--space-2);
		font-size: var(--text-sm);
		line-height: 1.2;
		white-space: nowrap;
	}

	.verdict {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-3) var(--space-5);
	}

	.band {
		font-stretch: var(--wdth-wide);
		font-weight: 800;
		font-size: clamp(3.5rem, 6vw, 5.5rem);
		line-height: var(--leading-display);
		letter-spacing: var(--tracking-display);
	}

	.score {
		font-weight: 700;
		font-size: var(--text-md);
	}

	.no-mood {
		font-weight: 700;
		font-size: var(--text-md);
	}

	.head-line {
		max-width: var(--measure);
	}

	.readings {
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
		container: readings / inline-size;
	}

	.section-head {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.section-head h2 {
		font-size: var(--text-xl);
	}

	.lede,
	.note {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
		max-width: var(--measure);
	}

	.family {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.family-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-1) var(--space-4);
	}

	.family-head p {
		font-size: var(--text-sm);
	}

	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
		border-top: var(--rule) solid var(--ink);
		border-bottom: var(--rule) solid var(--ink);
	}

	.foot {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-10);
		align-items: start;
	}

	.history,
	.method {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
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

	.skeleton {
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
	}

	.skeleton-head,
	.skeleton-family {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.waiting {
		font-size: 1rem;
	}

	@media (min-width: 768px) {
		h1 {
			font-size: var(--text-2xl);
		}
	}

	@media (min-width: 1024px) {
		.foot {
			grid-template-columns: minmax(0, 1fr) 27.5rem;
			gap: var(--space-12);
		}
	}
</style>
