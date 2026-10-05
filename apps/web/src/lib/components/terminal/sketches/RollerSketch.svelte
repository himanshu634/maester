<!--
	Overview: a paint roller on a bare wall. Drag it across and it paints the wall, until the
	paint runs dry halfway and leaves only streaks: the page needs another coat. Two plates, a
	colour plate out of register under an ink plate drawn twice. It moves only under the pointer
	and is not a control.
-->
<script lang="ts">
	import { clamp, pointerDrag } from '$lib/terminal/sketch';
	import SketchFilters from './SketchFilters.svelte';

	interface Props {
		label: string;
		lines: { idle: string; rolling: string; dry: string };
	}

	let { label, lines }: Props = $props();

	const uid = $props.id();
	const W = 520;
	const H = 480;
	const LEFT = 80;
	const RIGHT = 440;
	/** Where the paint runs out. */
	const DRY = 268;
	const streaks = [150, 186, 222, 258, 294];

	let x = $state(LEFT);
	let grip = 0;
	/** The furthest right the roller has been. */
	let reach = $state(LEFT);
	let painted = $derived(clamp(reach, LEFT, DRY));
	let said = $derived(reach > DRY + 12 ? lines.dry : reach > LEFT ? lines.rolling : lines.idle);

	const drag = pointerDrag(W, H, {
		start: (at) => {
			grip = at.x - x;
		},
		move: (at) => {
			x = clamp(at.x - grip, LEFT, RIGHT);
			reach = Math.max(reach, x);
		}
	});
</script>

<svg viewBox="0 0 {W} {H}" role="img" aria-labelledby="{uid}-title" class="sketch" {@attach drag}>
	<title id="{uid}-title">{label}</title>
	<defs>
		<SketchFilters {uid} />
		<!-- The wall, the skirting, the floor and an empty paint tray. -->
		<g id="{uid}-ink">
			<path d="M40 40 L 490 36 L 492 380 L 42 384 Z" />
			<path d="M42 360 L 492 356" />
			<path d="M10 430 L 510 428" />
			<path d="M60 400 L 170 398 L 160 428 L 70 430 Z" />
			<path d="M78 410 L 152 409" />
		</g>
		<!-- The roller: a drum standing on end, its frame and the handle hanging below it. -->
		<g id="{uid}-roller">
			<path d="M0 118 L 34 118 L 34 330 L 0 330 Z" />
			<path d="M34 224 L 56 224 L 56 336 L 22 336 L 22 350" />
			<path d="M14 350 L 30 350 L 32 432 L 16 432 Z" />
		</g>
		<clipPath id="{uid}-wall"><path d="M40 40 L 490 36 L 492 356 L 42 360 Z" /></clipPath>
	</defs>

	<!-- Colour plate, out of register: the paint so far, the tray. -->
	<g transform="translate(7 6)">
		<g clip-path="url(#{uid}-wall)">
			<rect x="40" y="118" width={painted - 40} height="212" fill="var(--illus-blue)" />
		</g>
		<path d="M60 400 L 170 398 L 160 428 L 70 430 Z" fill="var(--illus-yellow)" />
	</g>

	<!-- Past the halfway mark the roller is dry: only streaks. -->
	{#if reach > DRY}
		<g stroke="var(--illus-blue)" stroke-width="6" stroke-linecap="round" filter="url(#{uid}-r2)">
			{#each streaks as sy, i (sy)}
				<path d="M{DRY} {sy + 6} L {DRY + (reach - DRY) * (0.4 + (i % 3) * 0.2)} {sy + 4}" />
			{/each}
		</g>
	{/if}

	<!-- Ink plate, drawn twice so it reads as a hand-drawn line. -->
	<g class="ink" stroke-width="3.2" filter="url(#{uid}-r1)"><use href="#{uid}-ink" /></g>
	<g class="ink faint" stroke-width="1.4" filter="url(#{uid}-r2)" transform="translate(1.5 -1)">
		<use href="#{uid}-ink" />
	</g>

	<g transform="translate({x} 0)">
		<path
			d="M0 118 L 34 118 L 34 330 L 0 330 Z"
			fill="var(--illus-blue)"
			transform="translate(7 6)"
		/>
		<path
			d="M14 350 L 30 350 L 32 432 L 16 432 Z"
			fill="var(--illus-red)"
			transform="translate(7 6)"
		/>
		<g class="ink" stroke-width="3.2" filter="url(#{uid}-r1)"><use href="#{uid}-roller" /></g>
		<g class="ink faint" stroke-width="1.4" filter="url(#{uid}-r2)" transform="translate(1.5 -1)">
			<use href="#{uid}-roller" />
		</g>
	</g>

	<text class="hand" x="196" y="466" font-size="26">{said}</text>
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
