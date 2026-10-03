<!--
	The offline sketch: an unplugged cable and a wall socket. Drag the plug into the socket
	and it runs the same connection check as the page's "Check again" button; if the device
	is still offline, the plug drops back out. It moves only under the pointer, snapping in
	or out with no animation. The button stays the keyboard and screen-reader path.
-->
<script lang="ts">
	import type { Attachment } from 'svelte/attachments';

	interface Props {
		label: string;
		/** Runs the connection check; resolves true when the site answered. */
		onplug: () => Promise<boolean>;
	}

	let { label, onplug }: Props = $props();

	const uid = $props.id();
	const W = 342;
	const OUT = 90;
	const IN = 224;
	const CATCH = 214;

	let px = $state(OUT);
	let cable = $derived(`M-10 150 C 40 150, ${px - 40} 112, ${px} 112`);

	const drag: Attachment<SVGSVGElement> = (svg) => {
		let dragging = false;
		function at(event: PointerEvent) {
			const box = svg.getBoundingClientRect();
			const x = Math.round(((event.clientX - box.left) / box.width) * W) - 25;
			return Math.max(40, Math.min(IN, x));
		}
		function down(event: PointerEvent) {
			dragging = true;
			svg.setPointerCapture(event.pointerId);
			px = at(event);
		}
		function move(event: PointerEvent) {
			if (dragging) px = at(event);
		}
		async function up() {
			if (!dragging) return;
			dragging = false;
			if (px < CATCH) {
				px = OUT;
				return;
			}
			px = IN;
			const ok = await onplug();
			if (!ok) px = OUT;
		}
		// A cancelled drag (the browser took the gesture) never counts as plugging in.
		function cancel() {
			dragging = false;
			px = OUT;
		}
		svg.addEventListener('pointerdown', down);
		svg.addEventListener('pointermove', move);
		svg.addEventListener('pointerup', up);
		svg.addEventListener('pointercancel', cancel);
		return () => {
			svg.removeEventListener('pointerdown', down);
			svg.removeEventListener('pointermove', move);
			svg.removeEventListener('pointerup', up);
			svg.removeEventListener('pointercancel', cancel);
		};
	};
</script>

<svg viewBox="0 0 {W} 220" role="img" aria-labelledby="{uid}-title" class="sketch" {@attach drag}>
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
		<g id="{uid}-socket">
			<path d="M276 64 L 330 62 L 332 164 L 278 166 Z" />
			<path d="M292 98 L 292 112" />
			<path d="M312 98 L 312 112" />
			<path d="M270 196 L 340 194" />
		</g>
		<g id="{uid}-plug">
			<path d="M0 92 L 44 90 L 46 134 L 2 136 Z" />
			<path d="M46 104 L 60 104" />
			<path d="M46 120 L 60 120" />
		</g>
	</defs>

	<!-- The socket. -->
	<path d="M283 70 L 337 68 L 339 170 L 285 172 Z" fill="var(--illus-yellow)" />
	<g class="ink" stroke-width="3.2" filter="url(#{uid}-r1)"><use href="#{uid}-socket" /></g>
	<g class="ink faint" stroke-width="1.4" filter="url(#{uid}-r2)" transform="translate(1.5 -1)">
		<use href="#{uid}-socket" />
	</g>

	<!-- The cable, then the plug at the end of it. -->
	<path d={cable} class="ink" stroke-width="4" filter="url(#{uid}-r1)" />
	<g transform="translate({px} 0)">
		<path d="M7 98 L 51 96 L 53 140 L 9 142 Z" fill="var(--illus-red)" />
		<g class="ink" stroke-width="3.2" filter="url(#{uid}-r1)"><use href="#{uid}-plug" /></g>
		<g class="ink faint" stroke-width="1.4" filter="url(#{uid}-r2)" transform="translate(1.5 -1)">
			<use href="#{uid}-plug" />
		</g>
	</g>
</svg>

<style>
	.sketch {
		width: 100%;
		height: auto;
		color: var(--ink);
		/* The plug only moves sideways, so vertical swipes still scroll the page. */
		touch-action: pan-y;
		cursor: grab;
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
</style>
