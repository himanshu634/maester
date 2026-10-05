<script lang="ts">
	import { terminalContent } from '$lib/content/terminal';
	import SignedInPage from '$lib/components/terminal/SignedInPage.svelte';
	import ComingSoon from '$lib/components/terminal/ComingSoon.svelte';
	import CraneSketch from '$lib/components/terminal/sketches/CraneSketch.svelte';

	const copy = terminalContent.comingSoon.pages.holdings;
</script>

<SignedInPage page="holdings">
	<ComingSoon page="holdings">
		{#snippet sketch()}
			<CraneSketch label={copy.sketch.label} name="Holdings" lines={copy.sketch} />
		{/snippet}
	</ComingSoon>
</SignedInPage>
