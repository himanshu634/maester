<script lang="ts">
	/**
	 * The terminal frame. From 1024px a 224px rail on the left holds the wordmark, the
	 * workspace and the page list; a 56px context header runs across the content. Below
	 * 1024px the rail becomes a top bar whose Menu button opens the same list as a drawer.
	 * The rail lists only pages that exist. When the connection drops, a banner under the
	 * context header says so (OfflineBanner).
	 */
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import { content } from '$lib/content';
	import { terminalContent } from '$lib/content/terminal';
	import OfflineBanner from '$lib/components/errors/OfflineBanner.svelte';

	interface Props {
		demo: boolean;
		/** The overview the rail links to (and marks as current, unless `current` is false). */
		overview: '/terminal/demo' | '/terminal/demo/quiet';
		/** False on a page the rail does not list (an error page), so nothing is marked current. */
		current?: boolean;
		/** False where the page itself says the device is offline, so it isn't said twice. */
		offlineBanner?: boolean;
		children: Snippet;
	}

	let { demo, overview, current = true, offlineBanner = true, children }: Props = $props();

	const shell = terminalContent.shell;
	let open = $state(false);
	let menuButton = $state<HTMLButtonElement>();

	function onkeydown(event: KeyboardEvent) {
		if (open && event.key === 'Escape') {
			open = false;
			menuButton?.focus();
		}
	}
</script>

<svelte:window {onkeydown} />

<div class="shell">
	<header class="rail">
		<div class="bar">
			<a class="wordmark" href={resolve('/')}>{content.masthead.wordmark}</a>
			<button
				bind:this={menuButton}
				class="button outline menu"
				type="button"
				aria-expanded={open}
				aria-controls="terminal-menu"
				onclick={() => (open = !open)}
			>
				{shell.menu}
			</button>
		</div>
		<div id="terminal-menu" class={['drawer', { open }]}>
			<div class="workspace">
				<span class="muted">{shell.workspaceLabel}</span>
				<span class="name">{shell.workspaceName}</span>
			</div>
			<nav aria-label={shell.navLabel}>
				<a class={{ current }} href={resolve(overview)} aria-current={current ? 'page' : undefined}
					>{shell.overview}</a
				>
			</nav>
		</div>
	</header>

	<!-- A region, not a second <header>: the rail is already the page's banner landmark. -->
	<section class="context" aria-label={shell.contextLabel}>
		<span class="portfolio">{shell.portfolio(terminalContent.workspace)}</span>
		{#if demo}
			<a href={resolve('/')}>{terminalContent.leaveDemo}</a>
		{/if}
	</section>

	{#if offlineBanner}
		<OfflineBanner />
	{/if}

	<main id="main">
		{@render children()}
	</main>
</div>

<style>
	.shell {
		min-height: 100dvh;
	}

	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		height: var(--space-14);
		padding: 0 var(--space-4) 0 var(--space-6);
		border-bottom: var(--rule) solid var(--ink);
	}

	.wordmark {
		font-stretch: var(--wdth-wide);
		font-weight: 800;
		font-size: 1.5rem;
		letter-spacing: var(--tracking-heading);
		line-height: 1;
		text-decoration: none;
	}

	.menu {
		padding: 0 var(--space-4);
	}

	.drawer {
		display: none;
		flex-direction: column;
		border-bottom: var(--rule) solid var(--ink);
	}

	.drawer.open {
		display: flex;
	}

	.workspace {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-4) var(--space-6);
		border-bottom: var(--rule-thin) solid var(--ink-muted);
	}

	.workspace .muted {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
	}

	.name {
		font-weight: 700;
		font-size: 1rem;
	}

	nav {
		display: flex;
		flex-direction: column;
		padding: var(--space-5) var(--space-6);
	}

	nav a {
		display: flex;
		align-items: center;
		min-height: var(--target);
		padding: 0 var(--space-3);
		margin: 0 calc(-1 * var(--space-3));
	}

	nav .current {
		background: var(--ink);
		color: var(--paper);
		font-weight: 700;
		text-decoration: none;
	}

	.context {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		min-height: var(--space-14);
		padding: var(--space-2) var(--space-6);
		border-bottom: var(--rule) solid var(--ink);
	}

	.portfolio {
		font-weight: 700;
		font-size: 1rem;
	}

	main {
		min-width: 0;
		padding: var(--space-6) var(--space-6) var(--space-12);
	}

	@media (min-width: 1024px) {
		.shell {
			display: grid;
			grid-template-columns: var(--rail) minmax(0, 1fr);
			grid-template-rows: auto auto 1fr;
		}

		.rail {
			grid-row: 1 / span 3;
			border-right: var(--rule) solid var(--ink);
		}

		.bar {
			padding: 0 var(--space-6);
		}

		.wordmark {
			font-size: var(--text-xl);
		}

		.menu {
			display: none;
		}

		.drawer,
		.drawer.open {
			display: flex;
			border-bottom: 0;
		}

		.context {
			height: var(--space-14);
			padding: 0 var(--space-6);
		}

		/* Row 3 even when the banner row is empty. */
		main {
			grid-row: 3;
			max-width: var(--max-width);
			padding: var(--space-8) var(--space-6) var(--space-14);
		}
	}
</style>
