<!--
	An inverted line under the terminal's context header while the device is offline. It
	names when the page last loaded, so figures on screen are read as of that time. It
	appears and disappears with the connection, with no animation.
-->
<script lang="ts">
	import { online } from 'svelte/reactivity/window';
	import { errorContent } from '$lib/content/errors';
	import { clockTime } from '$lib/errors/errors';

	const loadedAt = clockTime(new Date());
	const copy = errorContent.banner;
</script>

<div class="banner" role="status">
	{#if online.current === false}
		<p class="inverted"><strong>{copy.lead}</strong> {copy.body(loadedAt)}</p>
	{/if}
</div>

<style>
	p {
		margin: 0;
		padding: var(--space-3) var(--space-6);
		background: var(--ink);
		color: var(--paper);
		font-size: 1rem;
		line-height: var(--leading-small);
	}
</style>
