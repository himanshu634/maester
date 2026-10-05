<script lang="ts">
	import { terminalContent } from '$lib/content/terminal';
	import SignedInPage from '$lib/components/terminal/SignedInPage.svelte';
	import ComingSoon from '$lib/components/terminal/ComingSoon.svelte';
	import SpannerSketch from '$lib/components/terminal/sketches/SpannerSketch.svelte';

	const copy = terminalContent.comingSoon.pages.settings;
</script>

<SignedInPage page="settings">
	<ComingSoon page="settings">
		{#snippet sketch()}
			<SpannerSketch label={copy.sketch.label} lines={copy.sketch} />
		{/snippet}
	</ComingSoon>
</SignedInPage>
