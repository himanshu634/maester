<!--
	Watchlist: a pair of binoculars on a beach, looking out to sea. Drag sideways and their view
	sweeps along the horizon; there is nothing in it yet. Two plates, a colour plate out of
	register under an ink plate drawn twice. It moves only under the pointer and is not a control.
-->
<script lang="ts">
	import { clamp, pointerDrag } from '$lib/terminal/sketch';
	import SketchFilters from './SketchFilters.svelte';

	interface Props {
		label: string;
		lines: { idle: string; empty: string };
	}

	let { label, lines }: Props = $props();

	const uid = $props.id();
	const W = 520;
	const H = 480;
	const HORIZON = 196;
	const waves = [
		[40, 236],
		[150, 252],
		[260, 230],
		[360, 248],
		[450, 234],
		[90, 272],
		[210, 280],
		[330, 276],
		[430, 286]
	];

	let vx = $state(260);
	/** How far the view has swept, all told. */
	let swept = $state(0);
	let last = 260;
	let said = $derived(swept > 120 ? lines.empty : lines.idle);

	const drag = pointerDrag(W, H, {
		start: () => {
			last = vx;
		},
		move: (at) => {
			vx = clamp(at.x, 120, 400);
			swept += Math.abs(vx - last);
			last = vx;
		}
	});
</script>

<svg viewBox="0 0 {W} {H}" role="img" aria-labelledby="{uid}-title" class="sketch" {@attach drag}>
	<title id="{uid}-title">{label}</title>
	<defs>
		<SketchFilters {uid} />
		<pattern
			id="{uid}-hatch"
			width="7"
			height="7"
			patternUnits="userSpaceOnUse"
			patternTransform="rotate(40)"
		>
			<line x1="0" y1="0" x2="0" y2="7" stroke="currentColor" stroke-width="1.6" />
		</pattern>
		<!-- The horizon, the waves and the edge of the sand. -->
		<g id="{uid}-ink">
			<path d="M10 {HORIZON} L 510 {HORIZON - 3}" />
			{#each waves as [wx, wy] (`${wx}-${wy}`)}
				<path d="M{wx} {wy} q 10 -8 20 0 q 10 8 20 0" />
			{/each}
			<path d="M20 318 Q 140 300 260 314 Q 400 330 500 308" />
		</g>
		<!-- The binoculars: two barrels, the bridge, the eyepieces. -->
		<g id="{uid}-glasses">
			<path d="M-72 340 L -14 338 L -12 438 L -70 440 Z" />
			<path d="M14 338 L 72 340 L 70 440 L 12 438 Z" />
			<path d="M-14 368 L 14 368 L 14 398 L -14 398" />
			<path d="M-60 324 L -26 324 L -26 338 L -60 338 Z" />
			<path d="M26 324 L 60 324 L 60 338 L 26 338 Z" />
		</g>
		<clipPath id="{uid}-view">
			<circle cx={vx - 46} cy={HORIZON - 20} r="64" />
			<circle cx={vx + 46} cy={HORIZON - 20} r="64" />
		</clipPath>
	</defs>

	<!-- Colour plate, out of register: the sand. -->
	<g transform="translate(7 6)">
		<path
			d="M20 318 Q 140 300 260 314 Q 400 330 500 308 L 494 446 Q 260 462 26 448 Z"
			fill="var(--illus-yellow)"
		/>
	</g>

	<!-- Ink plate, drawn twice so it reads as a hand-drawn line. -->
	<g class="ink" stroke-width="3.2" filter="url(#{uid}-r1)"><use href="#{uid}-ink" /></g>
	<g class="ink faint" stroke-width="1.4" filter="url(#{uid}-r2)" transform="translate(1.5 -1)">
		<use href="#{uid}-ink" />
	</g>

	<!-- What the binoculars see: the horizon, close up, and nothing on it. -->
	<g clip-path="url(#{uid}-view)">
		<rect width={W} height={H} fill="var(--paper)" />
		<rect width={W} height={H} fill="url(#{uid}-hatch)" opacity="0.12" />
		<path d="M0 {HORIZON + 4} Q {W / 2} {HORIZON - 2} {W} {HORIZON}" class="ink" stroke-width="5" />
	</g>
	<g class="ink" stroke-width="4" filter="url(#{uid}-r1)">
		<circle cx={vx - 46} cy={HORIZON - 20} r="64" />
		<circle cx={vx + 46} cy={HORIZON - 20} r="64" />
	</g>

	<!-- The binoculars, following the view. -->
	<g transform="translate({vx} 0)">
		<g transform="translate(7 6)">
			<path d="M-72 340 L -14 338 L -12 438 L -70 440 Z" fill="var(--illus-blue)" />
			<path d="M14 338 L 72 340 L 70 440 L 12 438 Z" fill="var(--illus-blue)" />
		</g>
		<path
			d="M-62 438 Q 0 476 62 438"
			fill="none"
			stroke="var(--illus-red)"
			stroke-width="6"
			stroke-linecap="round"
		/>
		<g class="ink" stroke-width="3.2" filter="url(#{uid}-r1)"><use href="#{uid}-glasses" /></g>
		<g class="ink faint" stroke-width="1.4" filter="url(#{uid}-r2)" transform="translate(1.5 -1)">
			<use href="#{uid}-glasses" />
		</g>
	</g>

	<text class="hand" x="24" y="56" font-size="28">{said}</text>
</svg>

<style>
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
