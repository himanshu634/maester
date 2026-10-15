<script lang="ts">
	import type { ExternalLink } from '$lib/content';
	import Wordmark from '$lib/components/Wordmark.svelte';

	interface Props {
		note: string;
		links: readonly ExternalLink[];
	}

	let { note, links }: Props = $props();
</script>

<div class="footer">
	<p class="muted note measure">{note}</p>
	<nav aria-label="Elsewhere" class="links">
		{#each links as link (link.href)}
			<!-- These leave the site entirely, so the router must not resolve them. -->
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a href={link.href} rel="me noopener">{link.label}</a>
		{/each}
	</nav>
	<span class="wordmark"><Wordmark decorative /></span>
</div>

<style>
	.footer {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		font-size: var(--text-sm);
	}

	.links {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-5);
	}

	.wordmark {
		display: block;
		height: 24px;
		align-self: flex-start;
	}
</style>
