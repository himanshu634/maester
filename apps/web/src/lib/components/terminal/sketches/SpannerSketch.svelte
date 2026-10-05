<!--
	Settings: a spanner on the one bolt fitted to a bracket; the other holes are empty and a nut
	lies on the floor. Drag around the bolt to turn the spanner: the parts are still being
	fitted. Two plates, a colour plate out of register under an ink plate drawn twice. It moves
	only under the pointer and is not a control.
-->
<script lang="ts">
	import { angleAround, angleStep, pointerDrag, type Point } from '$lib/terminal/sketch';
	import SketchFilters from './SketchFilters.svelte';

	interface Props {
		label: string;
		lines: { idle: string; turning: string; done: string };
	}

	let { label, lines }: Props = $props();

	const uid = $props.id();
	const W = 520;
	const H = 480;
	const BOLT: Point = { x: 260, y: 236 };
	const holes = [
		[140, 166],
		[380, 160],
		[144, 316],
		[384, 310]
	];

	/** The spanner's angle, in radians. */
	let angle = $state(-0.5);
	/** How far it has turned in all, either way. */
	let turned = $state(0);
	let prev = 0;
	let degrees = $derived((angle * 180) / Math.PI);
	let said = $derived(
		turned > 2 * Math.PI ? lines.done : turned > 0.3 ? lines.turning : lines.idle
	);

	const drag = pointerDrag(W, H, {
		start: (at) => {
			prev = angleAround(at, BOLT);
		},
		move: (at) => {
			const now = angleAround(at, BOLT);
			const step = angleStep(prev, now);
			prev = now;
			angle += step;
			turned += Math.abs(step);
		}
	});
</script>

<svg viewBox="0 0 {W} {H}" role="img" aria-labelledby="{uid}-title" class="sketch" {@attach drag}>
	<title id="{uid}-title">{label}</title>
	<defs>
		<SketchFilters {uid} />
		<!-- The bracket, its empty holes, the floor and a loose nut on it. -->
		<g id="{uid}-ink">
			<path d="M90 120 L 432 112 L 438 360 L 96 368 Z" />
			<path d="M96 368 L 112 400 L 452 392 L 438 360" />
			{#each holes as [hx, hy] (`${hx}-${hy}`)}
				<circle cx={hx} cy={hy} r="13" />
			{/each}
			<path d="M10 446 L 510 444" />
			<path d="M440 432 L 452 420 L 470 420 L 480 432 L 470 444 L 452 444 Z" />
			<circle cx="460" cy="432" r="5" />
		</g>
		<!-- The spanner, its ring around the origin, and the bolt's head inside it. -->
		<g id="{uid}-spanner">
			<circle cx="0" cy="0" r="32" />
			<path d="M-14 -8 L -7 -16 L 7 -16 L 14 -8 L 14 8 L 7 16 L -7 16 L -14 8 Z" />
			<path d="M28 -14 L 200 -12 Q 220 0 200 12 L 28 14" />
		</g>
	</defs>

	<!-- Colour plate, out of register: the bracket. -->
	<g transform="translate(7 6)">
		<path d="M90 120 L 432 112 L 438 360 L 96 368 Z" fill="var(--illus-blue)" />
		<path
			d="M440 432 L 452 420 L 470 420 L 480 432 L 470 444 L 452 444 Z"
			fill="var(--illus-yellow)"
		/>
	</g>
	{#each holes as [hx, hy] (`${hx}-${hy}`)}
		<circle cx={hx} cy={hy} r="13" fill="var(--paper)" />
	{/each}

	<!-- Ink plate, drawn twice so it reads as a hand-drawn line. -->
	<g class="ink" stroke-width="3.2" filter="url(#{uid}-r1)"><use href="#{uid}-ink" /></g>
	<g class="ink faint" stroke-width="1.4" filter="url(#{uid}-r2)" transform="translate(1.5 -1)">
		<use href="#{uid}-ink" />
	</g>

	<!-- The spanner, turned about the bolt. -->
	<g class="grab" transform="translate({BOLT.x} {BOLT.y}) rotate({degrees})">
		<g transform="translate(7 6)">
			<path d="M28 -14 L 200 -12 Q 220 0 200 12 L 28 14 Z" fill="var(--illus-red)" />
		</g>
		<circle cx="0" cy="0" r="32" fill="var(--paper)" />
		<g class="ink" stroke-width="3.2" filter="url(#{uid}-r1)"><use href="#{uid}-spanner" /></g>
		<g class="ink faint" stroke-width="1.4" filter="url(#{uid}-r2)" transform="translate(1.5 -1)">
			<use href="#{uid}-spanner" />
		</g>
	</g>

	<text class="hand" x="40" y="80" font-size="28">{said}</text>
</svg>

<style>
	/* A swipe on the drawing scrolls the page; only the part you drag keeps the touch. */
	.grab {
		touch-action: none;
	}

	.sketch {
		width: 100%;
		height: auto;
		color: var(--ink);
		touch-action: pan-y;
		cursor: grab;
		user-select: none;
	}

	.ink {
		fill: none;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.faint {
		opacity: 0.55;
	}

	.hand {
		font-family: var(--font-hand);
		font-weight: 600;
		fill: currentColor;
	}
</style>
