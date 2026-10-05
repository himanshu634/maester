<script lang="ts">
	import { terminalContent } from '$lib/content/terminal';
	import SignedInPage from '$lib/components/terminal/SignedInPage.svelte';
	import ComingSoon from '$lib/components/terminal/ComingSoon.svelte';
	import LampSketch from '$lib/components/terminal/sketches/LampSketch.svelte';

	const copy = terminalContent.comingSoon.pages.analyst;
</script>

<SignedInPage page="analyst">
	<ComingSoon page="analyst">
		{#snippet sketch()}
			<LampSketch label={copy.sketch.label} lines={copy.sketch} />
		{/snippet}
	</ComingSoon>
</SignedInPage>
