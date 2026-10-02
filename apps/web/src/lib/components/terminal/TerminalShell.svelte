<script lang="ts">
	/**
	 * The terminal frame. From 1024px a 224px rail on the left holds the wordmark, the
	 * workspace and the page list; a 56px context header runs across the content. Below
	 * 1024px the rail becomes a top bar whose Menu button opens the same list as a drawer.
	 * The rail lists only pages that exist.
	 */
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import { content } from '$lib/content';
	import { terminalContent } from '$lib/content/terminal';

	interface Props {
		demo: boolean;
		/** The page this is, so the rail marks it as current. */
		overview: '/terminal' | '/terminal/demo' | '/terminal/demo/quiet';
		/** Shown in the context header; without it the workspace name is. */
		portfolio?: string;
		/** Who is signed in. Absent in the demo, which has no session. */
		account?: { email: string; signingOut: boolean; failed?: boolean; onSignOut: () => void };
		children: Snippet;
	}

	let { demo, overview, portfolio, account, children }: Props = $props();

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
				<a class="current" href={resolve(overview)} aria-current="page">{shell.overview}</a>
			</nav>
			{#if account}
				<div class="account">
					<span class="muted">{shell.signedInAs}</span>
					<span class="email">{account.email}</span>
					<button
						class="button outline"
						type="button"
						disabled={account.signingOut}
						onclick={account.onSignOut}
					>
						{account.signingOut ? shell.signingOut : shell.signOut}
					</button>
					<p class="status" role="status" aria-live="polite">
						{account.failed ? shell.signOutFailed : ''}
					</p>
				</div>
			{/if}
		</div>
	</header>

	<!-- A region, not a second <header>: the rail is already the page's banner landmark. -->
	<section class="context" aria-label={shell.contextLabel}>
		<span class="portfolio">{portfolio ? shell.portfolio(portfolio) : shell.workspaceName}</span>
		{#if demo}
			<a href={resolve('/')}>{terminalContent.leaveDemo}</a>
		{/if}
	</section>

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

	.account {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-4) var(--space-6) var(--space-6);
		border-top: var(--rule) solid var(--ink);
	}

	.account .muted {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
	}

	.status {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
	}

	.status:empty {
		display: none;
	}

	.email {
		font-weight: 700;
		font-size: 1rem;
		overflow-wrap: anywhere;
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
			grid-template-rows: auto 1fr;
		}

		.rail {
			grid-row: 1 / span 2;
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
			min-height: calc(100dvh - var(--space-14));
		}

		.account {
			margin-top: auto;
		}

		.context {
			height: var(--space-14);
			padding: 0 var(--space-6);
		}

		main {
			max-width: var(--max-width);
			padding: var(--space-8) var(--space-6) var(--space-14);
		}
	}
</style>
