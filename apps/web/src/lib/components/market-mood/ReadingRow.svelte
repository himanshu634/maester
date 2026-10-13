<!--
	One reading on the Market mood page. From a 40rem container: name, what it measures and what
	it adds to the mood; then the value and its change; then its rank among its own 2 years; then
	where it came from. Below that it stacks, name and value on one line. The name opens the
	reading's own page. A missing value is "—", and the in-mood line says why.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import { marketMoodContent as copy } from '$lib/content/market-mood';
	import type { Reading } from '$lib/market-mood/types';
	import {
		formatPrevious,
		formatValue,
		inMoodLine,
		rankSentence,
		sourceLine
	} from '$lib/market-mood/view';
	import RankRuler from './RankRuler.svelte';
	import ScoreTick from './ScoreTick.svelte';

	interface Props {
		reading: Reading;
		latestSession: string | null;
	}

	let { reading, latestSession }: Props = $props();

	let words = $derived(copy.readings[reading.key]);
	let previous = $derived(formatPrevious(reading));
	let rank = $derived(rankSentence(reading));
</script>

<li class="row">
	<h4 class="name">
		<a href={resolve('/terminal/market-mood/[key]', { key: reading.key })}>{words.name}</a>
	</h4>
	<p class="measures muted">{words.measures}</p>
	<p class="value num">{formatValue(reading)}</p>
	{#if previous}<p class="previous num">{previous}</p>{/if}
	<div class="rank">
		{#if rank !== null && reading.rank !== null}
			<RankRuler rank={reading.rank} label={rank} />
			<p class="sentence">{rank}</p>
		{:else if rank !== null}
			<p class="sentence">{rank}</p>
		{:else}
			<p class="muted" aria-hidden="true">—</p>
		{/if}
	</div>
	<div class="mood"><ScoreTick line={inMoodLine(reading)} /></div>
	<p class="source muted num">{sourceLine(reading, latestSession)}</p>
</li>

<style>
	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		grid-template-areas:
			'name value'
			'measures measures'
			'previous previous'
			'rank rank'
			'mood mood'
			'source source';
		column-gap: var(--space-3);
		row-gap: var(--space-2);
		padding: 14px 0;
		align-items: baseline;
	}

	.row + :global(.row) {
		border-top: var(--rule-thin) solid var(--ink-muted);
	}

	.name {
		grid-area: name;
		margin: 0;
		font-size: 1rem;
		font-weight: 700;
		line-height: 1.3;
	}

	.measures {
		grid-area: measures;
		font-size: var(--text-sm);
		line-height: var(--leading-small);
		max-width: 26rem;
	}

	.value {
		grid-area: value;
		font-weight: 700;
		font-size: var(--text-base);
		white-space: nowrap;
		text-align: right;
	}

	.previous {
		grid-area: previous;
		font-size: var(--text-sm);
	}

	.rank {
		grid-area: rank;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}

	.sentence {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
	}

	.mood {
		grid-area: mood;
	}

	.source {
		grid-area: source;
		font-size: var(--text-sm);
		line-height: var(--leading-small);
	}

	@container readings (min-width: 40rem) {
		.row {
			grid-template-columns: minmax(0, 1.4fr) 8rem 12.5rem minmax(0, 1fr);
			grid-template-rows: auto auto 1fr;
			grid-template-areas:
				'name value rank source'
				'measures previous rank source'
				'mood . rank source';
			column-gap: var(--space-5);
			row-gap: var(--space-1);
			align-items: start;
		}

		.value {
			font-size: var(--text-md);
		}

		.previous {
			text-align: right;
			color: var(--ink-muted);
		}

		.mood {
			padding-top: var(--space-1);
		}
	}

	@container readings (min-width: 60rem) {
		.row {
			grid-template-columns: minmax(0, 1.4fr) 10rem 15rem minmax(0, 1fr);
			column-gap: var(--space-6);
		}
	}
</style>
