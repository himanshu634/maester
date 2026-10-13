<!--
	Where a reading sits among its own last 2 years: a rule from lowest to highest with a block at
	its rank. Drawing only; the rank sentence beside it carries the figure.
-->
<script lang="ts">
	import { marketMoodContent as copy } from '$lib/content/market-mood';

	interface Props {
		rank: number;
		/** The rank sentence, for screen readers. */
		label: string;
	}

	let { rank, label }: Props = $props();
</script>

<div class="rank">
	<div class="line" role="img" aria-label={label}>
		<div class="rule"></div>
		<div class="tick" style:left="0"></div>
		<div class="tick" style:left="50%"></div>
		<div class="tick" style:left="calc(100% - 1px)"></div>
		<div class="block" style:left="calc({rank}% - {(rank / 100) * 6}px)"></div>
	</div>
	<div class="ends muted" aria-hidden="true">
		<span>{copy.rank.lowest}</span><span>{copy.rank.highest}</span>
	</div>
</div>

<style>
	.rank {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		width: 100%;
	}

	.line {
		position: relative;
		height: 18px;
	}

	.rule {
		position: absolute;
		left: 0;
		right: 0;
		top: 8px;
		height: var(--rule);
		background: var(--ink);
	}

	.tick {
		position: absolute;
		top: 3px;
		width: 1px;
		height: 12px;
		background: var(--ink-muted);
	}

	.block {
		position: absolute;
		top: 0;
		width: 6px;
		height: 18px;
		background: var(--ink);
	}

	.ends {
		display: flex;
		justify-content: space-between;
		font-size: var(--text-sm);
	}
</style>
