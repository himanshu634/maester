<!--
	Where the last close sits in the year's range: a 2px rule from low to high, ticks at both ends,
	and a 6 by 18px block at the close. Drawing only: the figure and its note say the values.
-->
<script lang="ts">
	interface Props {
		/** 0 at the low, 100 at the high. */
		pct: number;
	}
	let { pct }: Props = $props();
	let at = $derived(Math.max(0, Math.min(100, pct)));
</script>

<div class="ruler" aria-hidden="true">
	<span class="rule"></span>
	<span class="tick start"></span>
	<span class="tick end"></span>
	<span class="block" style:left="calc({at}% - 3px)"></span>
</div>

<style>
	.ruler {
		position: relative;
		height: 22px;
	}
	.rule {
		position: absolute;
		inset: 10px 0 auto;
		height: var(--rule);
		background: var(--ink);
	}
	.tick {
		position: absolute;
		top: 4px;
		width: var(--rule);
		height: 14px;
		background: var(--ink);
	}
	.start {
		left: 0;
	}
	.end {
		right: 0;
	}
	.block {
		position: absolute;
		top: 2px;
		width: 6px;
		height: 18px;
		background: var(--ink);
	}
</style>
