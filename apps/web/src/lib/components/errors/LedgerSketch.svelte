<!--
	The not-found sketch: an open ledger with every line empty, and a magnifying glass that
	follows the pointer over it. Under the glass, in the hand lettering, it finds nothing.
	Drawn like the sign-in illustration, as two plates: a colour plate slightly out of
	register under an ink plate drawn twice. It moves only with the pointer, never on its own,
	and nothing in it is a control: the page's own link is the way out.
-->
<script lang="ts">
	import type { Attachment } from 'svelte/attachments';

	interface Props {
		label: string;
		/** The two lines of hand lettering found under the glass. */
		lens: readonly [string, string];
		/** Called the first time the glass moves. */
		onlook?: () => void;
	}

	let { label, lens, onlook }: Props = $props();

	const uid = $props.id();
	const W = 600;
	const H = 640;

	let lx = $state(360);
	let ly = $state(300);
	let looked = false;

	const follow: Attachment<SVGSVGElement> = (svg) => {
		function move(event: PointerEvent) {
			const box = svg.getBoundingClientRect();
			lx = Math.round(((event.clientX - box.left) / box.width) * W);
			ly = Math.round(((event.clientY - box.top) / box.height) * H);
			if (!looked) {
				looked = true;
				onlook?.();
			}
		}
		svg.addEventListener('pointermove', move);
		svg.addEventListener('pointerdown', move);
		return () => {
			svg.removeEventListener('pointermove', move);
			svg.removeEventListener('pointerdown', move);
		};
	};

	const rows = [0, 1, 2, 3, 4, 5, 6, 7, 8];
</script>

<svg viewBox="0 0 {W} {H}" role="img" aria-labelledby="{uid}-title" class="sketch" {@attach follow}>
	<title id="{uid}-title">{label}</title>
	<defs>
		<filter id="{uid}-r1" x="-3%" y="-3%" width="106%" height="106%">
			<feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="3" seed="7" result="n" />
			<feDisplacementMap
				in="SourceGraphic"
				in2="n"
				scale="3.2"
				xChannelSelector="R"
				yChannelSelector="G"
			/>
		</filter>
		<filter id="{uid}-r2" x="-3%" y="-3%" width="106%" height="106%">
			<feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="2" seed="19" result="n" />
			<feDisplacementMap
				in="SourceGraphic"
				in2="n"
				scale="4"
				xChannelSelector="R"
				yChannelSelector="G"
			/>
		</filter>
		<pattern
			id="{uid}-hatch"
			width="7"
			height="7"
			patternUnits="userSpaceOnUse"
			patternTransform="rotate(40)"
		>
			<line x1="0" y1="0" x2="0" y2="7" stroke="currentColor" stroke-width="1.6" />
		</pattern>
		<clipPath id="{uid}-lens"><circle cx={lx} cy={ly} r="74" /></clipPath>

		<!-- The ink plate: the open book, its ruled lines, the desk edge and a pencil. -->
		<g id="{uid}-ink">
			<path d="M70 150 L 300 130 L 300 520 L 70 540 Z" />
			<path d="M300 130 L 530 150 L 530 540 L 300 520" />
			{#each rows as i (i)}
				<path d="M95 {200 + i * 36} L 280 {186 + i * 36}" />
				<path d="M320 {186 + i * 36} L 505 {200 + i * 36}" />
			{/each}
			<path d="M200 160 L 200 520" />
			<path d="M420 150 L 420 525" />
			<path d="M60 560 Q 300 585 560 560" />
			<path d="M545 170 L 590 470" />
			<path d="M538 168 l 6 -14 l 8 12" />
		</g>
	</defs>

	<!-- Colour plate, out of register. -->
	<g transform="translate(7 6)">
		<path d="M70 150 L 300 130 L 300 520 L 70 540 Z" fill="var(--illus-yellow)" />
		<path d="M300 130 L 530 150 L 530 540 L 300 520 Z" fill="var(--illus-yellow)" />
		<path d="M286 128 L 312 128 L 312 600 L 299 586 L 286 600 Z" fill="var(--illus-red)" />
		<path d="M545 170 L 590 470 L 600 468 L 555 168 Z" fill="var(--illus-blue)" />
	</g>

	<!-- Ink plate, drawn twice so it reads as a hand-drawn line. -->
	<g class="ink" stroke-width="3.2" filter="url(#{uid}-r1)"><use href="#{uid}-ink" /></g>
	<g class="ink faint" stroke-width="1.4" filter="url(#{uid}-r2)" transform="translate(1.5 -1)">
		<use href="#{uid}-ink" />
	</g>

	<!-- What the glass finds. -->
	<g clip-path="url(#{uid}-lens)">
		<rect width={W} height={H} fill="var(--paper)" />
		<rect width={W} height={H} fill="url(#{uid}-hatch)" opacity="0.18" />
		<text class="hand" text-anchor="middle">
			<tspan x={lx} y={ly - 6}>{lens[0]}</tspan>
			<tspan x={lx} y={ly + 26}>{lens[1]}</tspan>
		</text>
	</g>

	<!-- The glass: rim and handle in ink, the handle's colour plate in red. -->
	<g class="ink" filter="url(#{uid}-r1)">
		<circle cx={lx} cy={ly} r="78" stroke-width="5" />
		<line x1={lx + 58} y1={ly + 58} x2={lx + 150} y2={ly + 150} stroke-width="16" />
	</g>
	<line
		x1={lx + 61}
		y1={ly + 60}
		x2={lx + 153}
		y2={ly + 152}
		stroke="var(--illus-red)"
		stroke-width="9"
		stroke-linecap="round"
	/>
</svg>

<style>
	.sketch {
		width: 100%;
		height: auto;
		color: var(--ink);
		/* Vertical swipes still scroll the page on a phone. */
		touch-action: pan-y;
		cursor: crosshair;
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
		font-size: 34px;
		fill: currentColor;
	}
</style>
