<!--
	Every signed-in terminal page goes through this. It asks the API who is signed in; until it
	knows, it shows the masthead and "Checking your session." Signed out, it goes to sign-in and
	back to this page afterwards. Signed in, it draws the terminal shell with the full page list
	and the account block. The demo routes do not use it: they have no session.
-->
<script module lang="ts">
	import type { SessionUser } from '$lib/session';

	/**
	 * Who was signed in when the last terminal page checked, so moving between terminal pages
	 * keeps the shell on screen instead of flashing "Checking your session." Each page still asks
	 * the API again. Only ever set in the browser: a prerendered page has no user.
	 */
	let known: SessionUser | null = null;
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { content } from '$lib/content';
	import { authClient } from '$lib/auth/client';
	import { endSession, readSession } from '$lib/session';
	import { signInAgainHref } from '$lib/errors/errors';
	import { terminalPage, type TerminalPageKey } from '$lib/terminal/pages';
	import Masthead from '$lib/components/Masthead.svelte';
	import TerminalShell from './TerminalShell.svelte';
	import Loader from '../loading/Loader.svelte';

	interface Props {
		page: TerminalPageKey;
		children: Snippet;
	}

	let { page, children }: Props = $props();

	let entry = $derived(terminalPage(page));
	let signIn = $derived(resolve(signInAgainHref(entry.path)));

	let user = $state<SessionUser | null>(known);
	let signingOut = $state(false);
	let signOutFailed = $state(false);

	/** Only the latest check may decide, so Try again cannot be overruled by a stale answer. */
	let latestCheck = 0;

	async function checkSession() {
		const mine = ++latestCheck;
		const session = await readSession(authClient());
		if (mine !== latestCheck) return;
		if (session.status === 'signed-in') {
			known = user = session.user;
		} else {
			known = user = null;
			goto(signIn, { replaceState: true });
		}
	}

	onMount(checkSession);

	async function signOut() {
		signingOut = true;
		signOutFailed = false;
		if (await endSession(authClient())) {
			known = null;
			goto(resolve('/'), { replaceState: true });
		} else {
			signingOut = false;
			signOutFailed = true;
		}
	}
</script>

<svelte:head>
	<title>{entry.label}. Maester</title>
	<meta name="robots" content="noindex" />
</svelte:head>

{#if user}
	<TerminalShell
		demo={false}
		overview="/terminal"
		{page}
		account={{ email: user.email, signingOut, failed: signOutFailed, onSignOut: signOut }}
	>
		{@render children()}
	</TerminalShell>
{:else}
	<Masthead {...content.masthead} />
	<main id="main" class="checking">
		<h1>{entry.label}</h1>
		<Loader label={content.terminal.checking} onretry={checkSession} />
		<noscript>
			<p><a href={signIn}>{content.terminal.noScript}</a></p>
		</noscript>
	</main>
{/if}

<style>
	.checking {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
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
