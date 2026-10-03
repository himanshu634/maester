<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { content } from '$lib/content';
	import { terminalContent } from '$lib/content/terminal';
	import { authClient } from '$lib/auth/client';
	import { endSession, readSession, type SessionUser } from '$lib/session';
	import Masthead from '$lib/components/Masthead.svelte';
	import TerminalShell from '$lib/components/terminal/TerminalShell.svelte';

	let user = $state<SessionUser | null>(null);
	let signingOut = $state(false);
	let signOutFailed = $state(false);

	onMount(async () => {
		const session = await readSession(authClient());
		if (session.status === 'signed-in') user = session.user;
		else goto(resolve('/login?next=/terminal'), { replaceState: true });
	});

	async function signOut() {
		signingOut = true;
		signOutFailed = false;
		if (await endSession(authClient())) {
			goto(resolve('/'), { replaceState: true });
		} else {
			signingOut = false;
			signOutFailed = true;
		}
	}
</script>

<svelte:head>
	<title>{content.terminal.heading}. Maester</title>
	<meta name="robots" content="noindex" />
</svelte:head>

{#if user}
	<TerminalShell
		demo={false}
		overview="/terminal"
		account={{ email: user.email, signingOut, failed: signOutFailed, onSignOut: signOut }}
	>
		<div class="placeholder">
			<h1>{content.terminal.heading}</h1>
			<p class="measure">{content.terminal.placeholder}</p>
			<p><a href={resolve('/terminal/demo')}>{terminalContent.enterDemo}</a></p>
		</div>
	</TerminalShell>
{:else}
	<Masthead {...content.masthead} />
	<main id="main" class="checking">
		<h1>{content.terminal.heading}</h1>
		<p class="muted" role="status">{content.terminal.checking}</p>
		<noscript>
			<p><a href={resolve('/login?next=/terminal')}>{content.terminal.noScript}</a></p>
		</noscript>
	</main>
{/if}

<style>
	.checking,
	.placeholder {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.checking {
		max-width: var(--max-width);
		margin: 0 auto;
		padding: var(--space-12) var(--gutter) var(--space-14) var(--gutter);
	}

	h1 {
		font-stretch: var(--wdth-wide);
		font-weight: 800;
		font-size: 2rem;
		line-height: var(--leading-heading);
		letter-spacing: var(--tracking-heading);
	}

	@media (min-width: 768px) {
		h1 {
			font-size: var(--text-2xl);
		}
	}
</style>
