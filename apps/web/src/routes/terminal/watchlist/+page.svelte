<script lang="ts">
	import { terminalContent } from '$lib/content/terminal';
	import SignedInPage from '$lib/components/terminal/SignedInPage.svelte';
	import ComingSoon from '$lib/components/terminal/ComingSoon.svelte';
	import BinocularsSketch from '$lib/components/terminal/sketches/BinocularsSketch.svelte';

	const copy = terminalContent.comingSoon.pages.watchlist;
</script>

<SignedInPage page="watchlist">
	<ComingSoon page="watchlist">
		{#snippet sketch()}
			<BinocularsSketch label={copy.sketch.label} lines={copy.sketch} />
		{/snippet}
	</ComingSoon>
</SignedInPage>
