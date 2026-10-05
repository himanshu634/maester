<script lang="ts">
	import { terminalContent } from '$lib/content/terminal';
	import SignedInPage from '$lib/components/terminal/SignedInPage.svelte';
	import ComingSoon from '$lib/components/terminal/ComingSoon.svelte';
	import CabinetSketch from '$lib/components/terminal/sketches/CabinetSketch.svelte';

	const copy = terminalContent.comingSoon.pages.research;
</script>

<SignedInPage page="research">
	<ComingSoon page="research">
		{#snippet sketch()}
			<CabinetSketch label={copy.sketch.label} lines={copy.sketch} />
		{/snippet}
	</ComingSoon>
</SignedInPage>
