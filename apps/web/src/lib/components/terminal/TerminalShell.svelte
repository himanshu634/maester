<script lang="ts">
	/**
	 * The terminal frame. From 1024px a 224px rail on the left holds the wordmark, the
	 * workspace and the page list; a 56px context header runs across the content. Below
	 * 1024px the rail becomes a top bar whose Menu button opens the same list as a drawer.
	 * The demo's rail lists its one page. Signed in (`page` set), it lists every page of the
	 * first release in groups, Activity and Settings at the foot; a page that does not work
	 * yet says "Soon" after its label and opens a coming-soon page. When the connection
	 * drops, a banner under the context header says so (OfflineBanner).
	 */
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import { content } from '$lib/content';
	import { terminalContent } from '$lib/content/terminal';
	import OfflineBanner from '$lib/components/errors/OfflineBanner.svelte';
	import { pagesIn, type TerminalPage, type TerminalPageKey } from '$lib/terminal/pages';

	interface Props {
		demo: boolean;
		/** The overview the rail links to (and marks as current, unless `current` is false). */
		overview: '/terminal' | '/terminal/demo' | '/terminal/demo/quiet';
		/** False on a page the rail does not list (an error page), so nothing is marked current. */
		current?: boolean;
		/**
		 * The signed-in page being shown. When set, the rail lists every signed-in page and marks
		 * this one current; `overview` and `current` then do not apply.
		 */
		page?: TerminalPageKey;
		/** False where the page itself says the device is offline, so it isn't said twice. */
		offlineBanner?: boolean;
		/** Shown in the context header; without it the workspace name is. */
		portfolio?: string;
		/** Who is signed in. Absent in the demo, which has no session. */
		account?: { email: string; signingOut: boolean; failed?: boolean; onSignOut: () => void };
		children: Snippet;
	}

	let {
		demo,
		overview,
		current = true,
		page,
		offlineBanner = true,
		portfolio,
		account,
		children
	}: Props = $props();

	const shell = terminalContent.shell;
	const groups = [pagesIn('portfolio'), pagesIn('research')];
	const foot = pagesIn('foot');
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

{#snippet link(item: TerminalPage)}
	{@const here = item.key === page}
	<a class={{ current: here }} href={resolve(item.path)} aria-current={here ? 'page' : undefined}>
		<span class="label">{item.label}</span>
		{#if item.soon}
			<span class="soon">{shell.soon}</span>
		{/if}
	</a>
{/snippet}

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
			{#if page}
				<nav aria-label={shell.navLabel}>
					{#each groups as group, index (index)}
						<div class="group">
							{#each group as item (item.key)}
								{@render link(item)}
							{/each}
						</div>
					{/each}
				</nav>
				<nav class="foot" aria-label={shell.footNavLabel}>
					{#each foot as item (item.key)}
						{@render link(item)}
					{/each}
				</nav>
			{:else}
				<nav aria-label={shell.navLabel}>
					<a
						class={{ current }}
						href={resolve(overview)}
						aria-current={current ? 'page' : undefined}>{shell.overview}</a
					>
				</nav>
			{/if}
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
		justify-content: space-between;
		gap: var(--space-2);
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

	/* The underline sits on the label alone, so "Soon" reads as a note, not part of the link text. */
	nav a:has(.label) {
		text-decoration: none;
	}

	.label {
		text-decoration: underline;
		text-underline-offset: 3px;
		text-decoration-thickness: 1.5px;
	}

	nav a:hover .label,
	nav .current .label {
		text-decoration: none;
	}

	/* A word, never a colour: the page does not work yet. */
	.soon {
		font-size: var(--text-sm);
		font-weight: 400;
		line-height: var(--leading-small);
		color: var(--ink-muted);
	}

	nav a:hover .soon,
	nav .current .soon {
		color: var(--paper-muted);
	}

	/* Groups of pages, a hairline between them. */
	.group + .group {
		margin-top: var(--space-3);
		padding-top: var(--space-3);
		border-top: var(--rule-thin) solid var(--ink-muted);
	}

	nav.foot {
		padding-top: 0;
		padding-bottom: var(--space-5);
	}

	nav.foot::before {
		content: '';
		display: block;
		margin-bottom: var(--space-3);
		border-top: var(--rule-thin) solid var(--ink-muted);
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
			min-height: calc(100dvh - var(--space-14));
		}

		/* The foot pages and the account sit at the bottom of the rail. */
		nav.foot {
			margin-top: auto;
			padding-bottom: var(--space-3);
		}

		nav.foot::before {
			display: none;
		}

		.account {
			margin-top: auto;
		}

		nav.foot + .account {
			margin-top: 0;
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
