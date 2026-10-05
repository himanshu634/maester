<!--
	Holdings: a crane holding a block with the page's name over a half-built wall. Drag the
	block down and it lowers on its cable, but it stops short of the wall: the walls are still
	going up. Drawn as two plates, a colour plate out of register under an ink plate drawn twice.
	It moves only under the pointer and is not a control.
-->
<script lang="ts">
	import { clamp, pointerDrag } from '$lib/terminal/sketch';
	import SketchFilters from './SketchFilters.svelte';

	interface Props {
		label: string;
		/** The word on the block. */
		name: string;
		lines: { idle: string; lower: string; landed: string };
	}

	let { label, name, lines }: Props = $props();

	const uid = $props.id();
	const W = 520;
	const H = 480;
	const TOP = 110;
	const LOWEST = 282;

	let y = $state(120);
	let moved = $state(false);
	let said = $derived(y >= LOWEST - 6 ? lines.landed : moved ? lines.lower : lines.idle);

	const drag = pointerDrag(W, H, {
		move: (at) => {
			y = clamp(at.y - 40, TOP, LOWEST);
			moved = true;
		}
	});
</script>

<svg viewBox="0 0 {W} {H}" role="img" aria-labelledby="{uid}-title" class="sketch" {@attach drag}>
	<title id="{uid}-title">{label}</title>
	<defs>
		<SketchFilters {uid} />
		<!-- The ground, the tower, the jib and its ties, the counterweight, the trolley, the wall. -->
		<g id="{uid}-ink">
			<path d="M20 444 L 510 444" />
			<path d="M112 444 L 112 64" />
			<path d="M142 444 L 142 64" />
			<path
				d="M112 404 L 142 364 L 112 324 L 142 284 L 112 244 L 142 204 L 112 164 L 142 124 L 112 84"
			/>
			<path d="M60 64 L 470 64" />
			<path d="M126 20 L 60 64" />
			<path d="M126 20 L 470 64" />
			<path d="M126 20 L 126 64" />
			<path d="M58 64 L 98 64 L 98 98 L 58 98 Z" />
			<path d="M376 64 L 392 64 L 392 74 L 376 74 Z" />
			<path d="M286 444 L 286 392 L 474 392 L 474 444" />
			<path d="M286 418 L 474 418" />
			<path d="M330 392 L 330 418" />
			<path d="M390 392 L 390 418" />
			<path d="M440 392 L 440 418" />
			<path d="M310 418 L 310 444" />
			<path d="M360 418 L 360 444" />
			<path d="M420 418 L 420 444" />
		</g>
		<!-- The hook, the slings and the block. -->
		<g id="{uid}-load">
			<path d="M384 120 L 384 132" />
			<path d="M376 132 Q 384 144 392 132" />
			<path d="M384 140 L 314 158" />
			<path d="M384 140 L 454 158" />
			<path d="M306 158 L 462 156 L 464 222 L 308 224 Z" />
		</g>
	</defs>

	<!-- Colour plate, out of register. -->
	<g transform="translate(7 6)">
		<path d="M112 444 L 112 64 L 142 64 L 142 444 Z" fill="var(--illus-red)" />
		<path d="M60 58 L 470 58 L 470 70 L 60 70 Z" fill="var(--illus-yellow)" />
		<path d="M286 444 L 286 392 L 474 392 L 474 444 Z" fill="var(--illus-yellow)" />
	</g>

	<!-- Ink plate, drawn twice so it reads as a hand-drawn line. -->
	<g class="ink" stroke-width="3.2" filter="url(#{uid}-r1)"><use href="#{uid}-ink" /></g>
	<g class="ink faint" stroke-width="1.4" filter="url(#{uid}-r2)" transform="translate(1.5 -1)">
		<use href="#{uid}-ink" />
	</g>

	<!-- The cable, then the load at the end of it. -->
	<!-- No roughness filter: a filter's region follows the bounding box, which a vertical line has none of. -->
	<path d="M384 70 Q 385.5 {(70 + y) / 2} 384 {y}" class="ink" stroke-width="3" />
	<g class="grab" transform="translate(0 {y - 120})">
		<rect x="296" y="112" width="178" height="120" fill="transparent" />
		<path
			d="M306 158 L 462 156 L 464 222 L 308 224 Z"
			fill="var(--illus-blue)"
			transform="translate(7 6)"
		/>
		<g class="ink" stroke-width="3.2" filter="url(#{uid}-r1)"><use href="#{uid}-load" /></g>
		<g class="ink faint" stroke-width="1.4" filter="url(#{uid}-r2)" transform="translate(1.5 -1)">
			<use href="#{uid}-load" />
		</g>
		<rect x="318" y="168" width="134" height="44" fill="var(--paper)" />
		<text class="hand" x="385" y="200" text-anchor="middle" font-size="32">{name}</text>
	</g>

	<text class="hand said" x="164" y="472" font-size="24">{said}</text>
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
		font-weight: 700;
		fill: currentColor;
	}

	.said {
		font-weight: 600;
	}
</style>
