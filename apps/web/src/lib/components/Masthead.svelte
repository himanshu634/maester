<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Link } from '$lib/content';

	interface Props {
		wordmark: string;
		nav: readonly Link[];
		terminal: Link;
	}

	let { wordmark, nav, terminal }: Props = $props();
</script>

<header class="masthead">
	<div class="inner">
		<a class="wordmark" href={resolve('/')}>{wordmark}</a>
		<nav aria-label="Primary">
			{#each nav as item (item.href)}
				<a href={resolve(item.href)}>{item.label}</a>
			{/each}
		</nav>
		<a class="button" href={resolve(terminal.href)}>{terminal.label}</a>
	</div>
</header>

<style>
	.masthead {
		border-bottom: var(--rule) solid var(--ink);
	}

	.inner {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-4) var(--space-6);
		max-width: var(--max-width);
		margin: 0 auto;
		padding: var(--space-4) var(--gutter);
	}

	.wordmark {
		font-stretch: var(--wdth-wide);
		font-weight: 800;
		font-size: var(--text-xl);
		letter-spacing: var(--tracking-heading);
		line-height: 1;
		text-decoration: none;
		margin-right: auto;
	}

	nav {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3) var(--space-6);
		order: 3;
		width: 100%;
	}

	@media (min-width: 768px) {
		nav {
			order: 0;
			width: auto;
			margin-right: var(--space-4);
		}
	}
</style>
