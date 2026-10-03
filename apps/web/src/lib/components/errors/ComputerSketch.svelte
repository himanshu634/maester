<!--
	The page-failed sketch: the sign-in illustration's old computer, small and still, with a
	question mark on its screen. Two plates like the other sketches. It never moves, because
	it can sit beside an investor's own figures in the terminal.
-->
<script lang="ts">
	interface Props {
		label: string;
	}

	let { label }: Props = $props();

	const uid = $props.id();
</script>

<svg viewBox="0 0 200 160" role="img" aria-labelledby="{uid}-title" class="sketch">
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
		<g id="{uid}-ink">
			<path d="M30 20 L 170 16 L 172 112 L 28 116 Z" />
			<path d="M46 34 L 154 32 L 155 98 L 45 100 Z" />
			<path d="M84 116 L 80 136 L 124 136 L 118 114" />
			<path d="M40 146 L 162 142" />
			<path d="M78 52 Q 100 40 116 56 Q 124 70 100 76 L 100 84" />
			<circle cx="100" cy="92" r="1.5" />
		</g>
	</defs>

	<g transform="translate(7 6)">
		<path d="M46 34 L 154 32 L 155 98 L 45 100 Z" fill="var(--illus-blue)" />
	</g>
	<g class="ink" stroke-width="3.2" filter="url(#{uid}-r1)"><use href="#{uid}-ink" /></g>
	<g class="ink faint" stroke-width="1.4" filter="url(#{uid}-r2)" transform="translate(1.5 -1)">
		<use href="#{uid}-ink" />
	</g>
</svg>

<style>
	.sketch {
		width: 100%;
		height: auto;
		color: var(--ink);
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
