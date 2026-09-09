<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { content } from '$lib/content';
	import { hasSession } from '$lib/session';
	import Masthead from '$lib/components/Masthead.svelte';

	let state = $state<'checking' | 'signed-in'>('checking');

	onMount(() => {
		if (hasSession()) {
			state = 'signed-in';
		} else {
			goto(resolve('/login?next=/terminal'), { replaceState: true });
		}
	});
</script>

<svelte:head>
	<title>{content.terminal.heading}. Maester</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<Masthead {...content.masthead} />

<main id="main" class="terminal">
	<h1>{content.terminal.heading}</h1>
	{#if state === 'signed-in'}
		<p class="measure">{content.terminal.placeholder}</p>
	{:else}
		<p class="muted" role="status">{content.terminal.checking}</p>
		<noscript>
			<p><a href={resolve('/login?next=/terminal')}>{content.terminal.noScript}</a></p>
		</noscript>
	{/if}
</main>

<style>
	.terminal {
		max-width: var(--max-width);
		margin: 0 auto;
		padding: var(--space-12) var(--gutter) var(--space-14) var(--gutter);
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	h1 {
		font-stretch: var(--wdth-wide);
		font-weight: 800;
		font-size: var(--text-2xl);
		line-height: var(--leading-heading);
		letter-spacing: var(--tracking-heading);
	}
</style>
