<script lang="ts">
	import SignedInPage from '$lib/components/terminal/SignedInPage.svelte';
	import ReadingPage from '$lib/components/market-mood/ReadingPage.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<SignedInPage page="market-mood">
	{#key data.key}
		<ReadingPage key={data.key} />
	{/key}
</SignedInPage>
