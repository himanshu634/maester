<!--
	"In the mood: ▮ 19 · very cautious": what one reading adds to the mood, on a 72px rule with a
	tick at the middle. A reading left out says why instead.
-->
<script lang="ts">
	import { marketMoodContent as copy } from '$lib/content/market-mood';
	import type { InMood } from '$lib/market-mood/view';

	interface Props {
		line: InMood;
	}

	let { line }: Props = $props();
</script>

{#if line.kind === 'score'}
	<p class="in-mood">
		<span class="label">{copy.inMood.label}</span>
		<span class="tick" role="img" aria-label={copy.inMood.tickLabel(line.score)}>
			<span class="rule"></span>
			<span class="middle"></span>
			<span class="block" style:left="calc({line.score}% - {(line.score / 100) * 6}px)"></span>
		</span>
		<span class="num">{copy.inMood.scoreWords(line.score, line.band)}</span>
	</p>
{:else}
	<p class="out muted">{line.text}</p>
{/if}

<style>
	.in-mood {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
	}

	.label {
		font-weight: 700;
	}

	.tick {
		position: relative;
		display: inline-block;
		width: 72px;
		height: 18px;
		flex-shrink: 0;
	}

	.rule {
		position: absolute;
		left: 0;
		right: 0;
		top: 8px;
		height: var(--rule);
		background: var(--ink);
	}

	.middle {
		position: absolute;
		left: 36px;
		top: 4px;
		width: 1px;
		height: 10px;
		background: var(--ink-muted);
	}

	.block {
		position: absolute;
		top: 0;
		width: 6px;
		height: 18px;
		background: var(--ink);
	}

	.out {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
	}
</style>
