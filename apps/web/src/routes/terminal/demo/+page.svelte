<script lang="ts">
	import { terminalContent } from '$lib/content/terminal';
	import { demo } from '$lib/terminal/fixture';
	import Overview from '$lib/components/terminal/Overview.svelte';
</script>

<svelte:head>
	<title>{terminalContent.pageTitle}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<Overview data={demo} path="/terminal/demo" />
