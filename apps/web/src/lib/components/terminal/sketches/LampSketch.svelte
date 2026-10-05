<!--
	Analyst: a desk lamp beside an empty chair. Pull the lamp's cord down and let go, and the
	light comes on over the chair: nobody is in it yet. The cord snaps back with no animation.
	Two plates, a colour plate out of register under an ink plate drawn twice. It moves only
	under the pointer and is not a control.
-->
<script lang="ts">
	import { clamp, pointerDrag } from '$lib/terminal/sketch';
	import SketchFilters from './SketchFilters.svelte';

	interface Props {
		label: string;
		lines: { idle: string; on: string; off: string };
	}

	let { label, lines }: Props = $props();

	const uid = $props.id();
	const W = 520;
	const H = 480;
	const LONGEST = 70;
	const CLICK = 46;

	let pull = $state(0);
	let lit = $state(false);
	let switched = $state(false);
	let grip = 0;
	let said = $derived(lit ? lines.on : switched ? lines.off : lines.idle);
	let bead = $derived(222 + pull);

	const drag = pointerDrag(W, H, {
		start: (at) => {
			grip = at.y;
		},
		move: (at) => {
			pull = clamp(at.y - grip, 0, LONGEST);
		},
		end: (_at, cancelled) => {
			if (!cancelled && pull >= CLICK) {
				lit = !lit;
				switched = true;
			}
			pull = 0;
		}
	});
</script>

<svg viewBox="0 0 {W} {H}" role="img" aria-labelledby="{uid}-title" class="sketch" {@attach drag}>
	<title id="{uid}-title">{label}</title>
	<defs>
		<SketchFilters {uid} />
		<!-- The lamp, the desk, the empty chair and the floor. -->
		<g id="{uid}-ink">
			<path d="M84 296 Q 126 278 168 294" />
			<path d="M126 288 L 110 186 L 204 112" />
			<circle cx="110" cy="186" r="6" />
			<path d="M195 100 L 228 88 L 292 142 L 206 170 Z" />
			<path d="M40 300 L 330 296" />
			<path d="M40 314 L 330 310" />
			<path d="M40 300 L 40 314" />
			<path d="M330 296 L 330 310" />
			<path d="M60 314 L 62 440" />
			<path d="M310 310 L 312 440" />
			<path d="M352 332 L 462 328" />
			<path d="M352 346 L 462 342" />
			<path d="M444 330 L 454 206 L 476 208 L 466 342" />
			<path d="M360 346 L 352 440" />
			<path d="M456 344 L 464 440" />
			<path d="M10 442 L 510 440" />
		</g>
	</defs>

	<!-- The light, when it is on: it falls on the empty chair. -->
	{#if lit}
		<path d="M206 170 L 292 142 L 506 440 L 300 440 Z" fill="var(--illus-yellow)" />
	{/if}

	<!-- Colour plate, out of register. -->
	<g transform="translate(7 6)">
		<path d="M195 100 L 228 88 L 292 142 L 206 170 Z" fill="var(--illus-red)" />
		<path d="M40 300 L 330 296 L 330 310 L 40 314 Z" fill="var(--illus-blue)" />
	</g>

	<!-- Ink plate, drawn twice so it reads as a hand-drawn line. -->
	<g class="ink" stroke-width="3.2" filter="url(#{uid}-r1)"><use href="#{uid}-ink" /></g>
	<g class="ink faint" stroke-width="1.4" filter="url(#{uid}-r2)" transform="translate(1.5 -1)">
		<use href="#{uid}-ink" />
	</g>

	<!-- The cord and its bead. -->
	<!-- No roughness filter: a filter's region follows the bounding box, which a vertical line has none of. -->
	<path d="M250 156 Q 252 {(156 + bead) / 2} 250 {bead - 8}" class="ink" stroke-width="2.4" />
	<circle cx="257" cy={bead + 6} r="8" fill="var(--illus-red)" />
	<circle cx="250" cy={bead} r="8" class="ink" stroke-width="3" filter="url(#{uid}-r1)" />
	<rect class="grab" x="226" y="150" width="48" height={bead + 24 - 150} fill="transparent" />

	<text class="hand" x="270" y="56" font-size="26">{said}</text>
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
