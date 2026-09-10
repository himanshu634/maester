<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="color-scheme" content="light" />
	<meta name="theme-color" content="#000000" />
</svelte:head>

<a class="skip-link" href="#main">Skip to content</a>
{@render children()}
