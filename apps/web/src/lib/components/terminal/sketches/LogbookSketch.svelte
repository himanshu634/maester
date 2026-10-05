<!--
	Activity: a logbook with every line empty and a pencil. Drag the pencil along the first line
	and it writes the only entry there is: first entry soon. Two plates, a colour plate out of
	register under an ink plate drawn twice. It moves only under the pointer and is not a control.
-->
<script lang="ts">
	import { clamp, pointerDrag } from '$lib/terminal/sketch';
	import SketchFilters from './SketchFilters.svelte';

	interface Props {
		label: string;
		lines: { idle: string; writing: string; written: string; entry: string };
	}

	let { label, lines }: Props = $props();

	const uid = $props.id();
	const W = 520;
	const H = 480;
	const START = 124;
	const END = 420;
	const LINE = 178;
	/** Where the entry's last letter ends. */
	const DONE = 360;
	const ruled = [LINE, 228, 278, 328, 378];
	const rings = [110, 170, 230, 290, 350, 410];

	let px = $state(START);
	let grip = 0;
	/** The furthest right the pencil has written. */
	let reach = $state(START);
	let said = $derived(
		reach >= DONE ? lines.written : reach > START + 8 ? lines.writing : lines.idle
	);

	const drag = pointerDrag(W, H, {
		start: (at) => {
			grip = at.x - px;
		},
		move: (at) => {
			px = clamp(at.x - grip, START, END);
			reach = Math.max(reach, px);
		}
	});
</script>

<svg viewBox="0 0 {W} {H}" role="img" aria-labelledby="{uid}-title" class="sketch" {@attach drag}>
	<title id="{uid}-title">{label}</title>
	<defs>
		<SketchFilters {uid} />
		<!-- The logbook: its page, the rings along the top, the ruled lines. -->
		<g id="{uid}-ink">
			<path d="M60 82 L 460 76 L 466 424 L 64 430 Z" />
			{#each rings as rx (rx)}
				<path d="M{rx} 92 q -10 -30 8 -34 q 14 0 10 26" />
			{/each}
			{#each ruled as ry (ry)}
				<path d="M74 {ry} L 450 {ry - 3}" />
			{/each}
			<path d="M10 446 L 510 444" />
		</g>
		<!-- The pencil, its point at the origin. -->
		<g id="{uid}-pencil">
			<path d="M0 0 L 14 -30 L 30 -20 Z" />
			<path d="M14 -30 L 120 -150 L 136 -140 L 30 -20" />
			<path d="M120 -150 L 132 -164 L 148 -154 L 136 -140" />
		</g>
		<clipPath id="{uid}-ink-so-far"><rect x="0" y="0" width={reach} height={H} /></clipPath>
	</defs>

	<!-- Colour plate, out of register: the page's margin rule. -->
	<g transform="translate(7 6)">
		<path d="M110 82 L 112 424" stroke="var(--illus-red)" stroke-width="4" fill="none" />
	</g>

	<!-- Ink plate, drawn twice so it reads as a hand-drawn line. -->
	<g class="ink" stroke-width="3.2" filter="url(#{uid}-r1)"><use href="#{uid}-ink" /></g>
	<g class="ink faint" stroke-width="1.4" filter="url(#{uid}-r2)" transform="translate(1.5 -1)">
		<use href="#{uid}-ink" />
	</g>

	<!-- What the pencil has written so far. -->
	<g clip-path="url(#{uid}-ink-so-far)">
		<text class="hand" x={START} y={LINE - 8} font-size="40">{lines.entry}</text>
	</g>

	<!-- The pencil, point on the line. -->
	<g transform="translate({px} {LINE - 4})">
		<g transform="translate(7 6)">
			<path d="M14 -30 L 120 -150 L 136 -140 L 30 -20 Z" fill="var(--illus-yellow)" />
			<path d="M120 -150 L 132 -164 L 148 -154 L 136 -140 Z" fill="var(--illus-red)" />
		</g>
		<g class="ink" stroke-width="3.2" filter="url(#{uid}-r1)"><use href="#{uid}-pencil" /></g>
		<g class="ink faint" stroke-width="1.4" filter="url(#{uid}-r2)" transform="translate(1.5 -1)">
			<use href="#{uid}-pencil" />
		</g>
	</g>

	<text class="hand said" x="64" y="472" font-size="26">{said}</text>
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
