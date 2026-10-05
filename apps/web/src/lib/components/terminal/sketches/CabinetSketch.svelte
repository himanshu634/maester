<!--
	Research: a filing cabinet seen from the side. Drag the top drawer open and it holds one
	note, still being sorted. Two plates, a colour plate out of register under an ink plate
	drawn twice. It moves only under the pointer and is not a control.
-->
<script lang="ts">
	import { clamp, pointerDrag } from '$lib/terminal/sketch';
	import SketchFilters from './SketchFilters.svelte';

	interface Props {
		label: string;
		lines: { idle: string; open: string; note: readonly [string, string] };
	}

	let { label, lines }: Props = $props();

	const uid = $props.id();
	const W = 520;
	const H = 480;
	const OPEN = 170;

	/** How far the top drawer is out. */
	let d = $state(0);
	let grip = 0;
	let said = $derived(d > 120 ? lines.open : lines.idle);

	const drag = pointerDrag(W, H, {
		start: (at) => {
			grip = at.x - d;
		},
		move: (at) => {
			d = clamp(at.x - grip, 0, OPEN);
		}
	});
</script>

<svg viewBox="0 0 {W} {H}" role="img" aria-labelledby="{uid}-title" class="sketch" {@attach drag}>
	<title id="{uid}-title">{label}</title>
	<defs>
		<SketchFilters {uid} />
		<!-- The cabinet's side, its two closed drawers' fronts, and the floor. -->
		<g id="{uid}-ink">
			<path d="M70 96 L 262 92 L 264 440 L 72 442 Z" />
			<path d="M70 96 L 104 70 L 296 66 L 262 92" />
			<path d="M296 66 L 296 92" />
			<path d="M262 210 L 280 210 L 282 322 L 264 322" />
			<path d="M264 330 L 282 330 L 282 436 L 264 436" />
			<path d="M282 262 L 292 262" />
			<path d="M282 380 L 292 380" />
			<path d="M20 444 L 500 442" />
		</g>
		<!-- The one note, standing up at the back of the drawer. -->
		<g id="{uid}-note">
			<path d="M112 26 L 214 20 L 218 120 L 116 124 Z" />
		</g>
		<clipPath id="{uid}-out"><rect x="263" y="0" width={W} height={H} /></clipPath>
	</defs>

	<!-- Colour plate, out of register. -->
	<g transform="translate(7 6)">
		<path d="M70 96 L 262 92 L 264 440 L 72 442 Z" fill="var(--illus-yellow)" />
		<path d="M70 96 L 104 70 L 296 66 L 262 92 Z" fill="var(--illus-blue)" />
		<path d="M262 210 L 280 210 L 282 322 L 264 322 Z" fill="var(--illus-red)" />
		<path d="M264 330 L 282 330 L 282 436 L 264 436 Z" fill="var(--illus-red)" />
	</g>

	<!-- Ink plate, drawn twice so it reads as a hand-drawn line. -->
	<g class="ink" stroke-width="3.2" filter="url(#{uid}-r1)"><use href="#{uid}-ink" /></g>
	<g class="ink faint" stroke-width="1.4" filter="url(#{uid}-r2)" transform="translate(1.5 -1)">
		<use href="#{uid}-ink" />
	</g>

	<!-- The top drawer, slid out by d. What is still inside the cabinet stays hidden. -->
	<g clip-path="url(#{uid}-out)">
		<g transform="translate({d} 0)">
			<path d="M112 26 L 214 20 L 218 120 L 116 124 Z" fill="var(--paper)" />
			<g class="ink" stroke-width="3" filter="url(#{uid}-r1)"><use href="#{uid}-note" /></g>
			<text class="hand" text-anchor="middle" font-size="28" transform="rotate(-3 165 70)">
				<tspan x="165" y="58">{lines.note[0]}</tspan>
				<tspan x="165" y="88">{lines.note[1]}</tspan>
			</text>
			<path d="M80 104 L 262 104 L 262 198 L 80 198 Z" fill="var(--paper)" />
			<path
				d="M80 104 L 262 104 L 262 198 L 80 198 Z"
				fill="var(--illus-yellow)"
				transform="translate(7 6)"
			/>
			<g class="ink" stroke-width="3.2" filter="url(#{uid}-r1)">
				<path d="M80 104 L 262 104 L 262 198 L 80 198" />
			</g>
		</g>
	</g>
	<g transform="translate({d} 0)">
		<path
			d="M262 96 L 282 96 L 282 202 L 262 202 Z"
			fill="var(--illus-red)"
			transform="translate(7 6)"
		/>
		<g class="ink" stroke-width="3.2" filter="url(#{uid}-r1)">
			<path d="M262 96 L 282 96 L 282 202 L 262 202 Z" />
			<path d="M282 146 L 296 146" />
		</g>
		<g class="ink faint" stroke-width="1.4" filter="url(#{uid}-r2)" transform="translate(1.5 -1)">
			<path d="M262 96 L 282 96 L 282 202 L 262 202 Z" />
		</g>
	</g>

	<text class="hand said" x="300" y="300" font-size="26">{said}</text>
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
		font-weight: 700;
		fill: currentColor;
	}

	.said {
		font-weight: 600;
	}
</style>
