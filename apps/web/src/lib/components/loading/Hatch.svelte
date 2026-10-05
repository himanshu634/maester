<!--
	A drafting-paper box where a value will be: a 1px outline filled with 45 degree lines
	that drift one pixel per step. It means "not read yet", never "unknown" (unknown is "—"
	or a dashed outline). It takes the colour of the text around it, so on an ink panel it
	draws in paper. The lines are SVG, not a CSS gradient, because DESIGN.md forbids
	gradients and a data-URI tile could not use the colour tokens. Hidden from screen
	readers: the region it sits in is aria-busy and a status line says what is loading.
-->
<script lang="ts">
	import { HATCH_STEPS } from '$lib/loading/loading';
	import { useStep } from '$lib/loading/step.svelte';

	interface Props {
		/** Any CSS length. Match the value it stands in for, so nothing moves on arrival. */
		width?: string;
		height?: string;
	}

	let { width = '100%', height = '1.125rem' }: Props = $props();

	const id = $props.id();
	const step = useStep(HATCH_STEPS);
</script>

<span class="hatch" style:width style:height aria-hidden="true">
	<svg width="100%" height="100%" focusable="false">
		<defs>
			<pattern
				id="hatch-{id}"
				patternUnits="userSpaceOnUse"
				width="6"
				height="6"
				patternTransform="rotate(45) translate({step.current} 0)"
			>
				<line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" stroke-width="1" />
			</pattern>
		</defs>
		<rect width="100%" height="100%" fill="url(#hatch-{id})" />
	</svg>
</span>

<style>
	.hatch {
		display: block;
		flex-shrink: 0;
		max-width: 100%;
		box-sizing: border-box;
		overflow: hidden;
		border: var(--rule-thin) solid currentColor;
		line-height: 0;
	}

	svg {
		display: block;
	}
</style>
