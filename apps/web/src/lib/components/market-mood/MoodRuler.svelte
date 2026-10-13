<!--
	The mood on a 0–100 rule: ticks at every 20, the five band names under it (the current one
	bold), and an ink block at the score. Unknown draws no block and says so; it never sits in
	the middle. One image for screen readers, labelled with the score and band in words.
-->
<script lang="ts">
	import { marketMoodContent as copy } from '$lib/content/market-mood';
	import { bandLabel, bandOf } from '$lib/market-mood/view';
	import type { MoodBand } from '$lib/market-mood/types';

	interface Props {
		score: number | null;
		inverted?: boolean;
	}

	let { score, inverted = false }: Props = $props();

	const BANDS: MoodBand[] = ['very_cautious', 'cautious', 'middling', 'eager', 'very_eager'];

	let band = $derived(score === null ? null : bandOf(score));
	let label = $derived(
		score === null || band === null ? copy.ruler.unknown : copy.ruler.label(score, bandLabel(band))
	);
</script>

<div class={['ruler', { inverted }]} role="img" aria-label={label}>
	<div class="rule"></div>
	{#each [0, 20, 40, 60, 80, 100] as at (at)}
		<div class="tick" style:left="{at}%"></div>
	{/each}
	<div class="names">
		{#each BANDS as name (name)}
			<span class={{ current: name === band }}>{bandLabel(name)}</span>
		{/each}
	</div>
	{#if score !== null}
		<div class="block" style:left="calc({score}% - {(score / 100) * 8}px)"></div>
	{/if}
</div>

<style>
	.ruler {
		position: relative;
		width: 100%;
		max-width: 54rem;
		padding-top: 26px;
		color: var(--ink);
	}

	.rule {
		position: absolute;
		left: 0;
		right: 0;
		top: 16px;
		height: var(--rule);
		background: currentColor;
	}

	.tick {
		position: absolute;
		top: 10px;
		width: 1px;
		height: 14px;
		margin-left: -0.5px;
		background: var(--ink-muted);
	}

	.tick:first-of-type {
		margin-left: 0;
	}

	.block {
		position: absolute;
		top: 0;
		width: 8px;
		height: 26px;
		background: currentColor;
	}

	.names {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
	}

	.names span {
		padding: 0 var(--space-1) 0 6px;
		font-size: var(--text-sm);
		line-height: 1.3;
		color: var(--ink-muted);
	}

	.names span.current {
		font-weight: 700;
		color: var(--ink);
	}

	.inverted {
		color: var(--paper);
	}

	.inverted .tick {
		background: var(--paper-muted);
	}

	.inverted .names span {
		color: var(--paper-muted);
	}

	.inverted .names span.current {
		color: var(--paper);
	}

	@media (min-width: 768px) {
		.names span {
			font-size: 1rem;
		}
	}
</style>
