<!--
	The loader's drawing: a 2px rule with an ink block, an eighth of its length, that steps
	along it. The block's position comes from the page's shared wait clock, so every ruler
	moves together. Decoration only; whatever is being waited for says so in words.
-->
<script lang="ts">
	import { RULER_STEPS } from '$lib/loading/loading';
	import { useStep } from '$lib/loading/step.svelte';

	interface Props {
		/** On an ink panel, draw in paper. */
		inverted?: boolean;
	}

	let { inverted = false }: Props = $props();

	const step = useStep(RULER_STEPS);
</script>

<span class={['ruler', inverted && 'inverted']} aria-hidden="true">
	<span class="block" style:left="{step.current * 12.5}%"></span>
</span>

<style>
	.ruler {
		position: relative;
		display: block;
		height: 6px;
		color: var(--ink);
	}

	.inverted {
		color: var(--paper);
	}

	.ruler::before {
		content: '';
		position: absolute;
		top: 2px;
		right: 0;
		left: 0;
		height: var(--rule);
		background: currentColor;
	}

	.block {
		position: absolute;
		top: 0;
		width: 12.5%;
		height: 6px;
		background: currentColor;
	}
</style>
