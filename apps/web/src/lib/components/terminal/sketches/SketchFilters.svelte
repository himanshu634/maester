<!--
	The two roughness filters every sketch shares, so a straight path reads as a hand-drawn
	line: r1 for the main ink plate, r2 for the fainter second pass. Same recipe as the error
	sketches. Goes inside the sketch's <defs>; `uid` keeps the ids unique on the page.
-->
<svelte:options namespace="svg" />

<script lang="ts">
	let { uid }: { uid: string } = $props();
</script>

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
