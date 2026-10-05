<script lang="ts">
	import { terminalContent } from '$lib/content/terminal';
	import SignedInPage from '$lib/components/terminal/SignedInPage.svelte';
	import ComingSoon from '$lib/components/terminal/ComingSoon.svelte';
	import LogbookSketch from '$lib/components/terminal/sketches/LogbookSketch.svelte';

	const copy = terminalContent.comingSoon.pages.activity;
</script>

<SignedInPage page="activity">
	<ComingSoon page="activity">
		{#snippet sketch()}
			<LogbookSketch label={copy.sketch.label} lines={copy.sketch} />
		{/snippet}
	</ComingSoon>
</SignedInPage>
