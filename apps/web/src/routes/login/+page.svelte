<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { authContent as copy } from '$lib/content/auth';
	import { authClient } from '$lib/auth/client';
	import { messageFor, type AuthMessage } from '$lib/auth/messages';
	import { readSession, safeNext } from '$lib/session';
	import AuthLayout from '$lib/components/auth/AuthLayout.svelte';
	import GoogleButton from '$lib/components/auth/GoogleButton.svelte';
	import Notice from '$lib/components/auth/Notice.svelte';

	let next = $state('/terminal');
	let message = $state<AuthMessage | null>(null);
	let googleBusy = $state(false);
	let status = $state('');

	onMount(async () => {
		next = safeNext(page.url.searchParams.get('next'));
		message = messageFor(page.url.searchParams.get('error'));
		const session = await readSession(authClient());
		if (session.status === 'signed-in') {
			status = copy.login.alreadySignedIn;
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- next is a same-site path checked by safeNext
			goto(next, { replaceState: true });
		}
	});

	async function continueWithGoogle() {
		googleBusy = true;
		status = copy.login.googleStatus;
		const errorCallbackURL = `/login?next=${encodeURIComponent(next)}`;
		const { error } = await authClient().signIn.social({
			provider: 'google',
			callbackURL: next,
			errorCallbackURL
		});
		if (error) {
			googleBusy = false;
			status = '';
			message = messageFor(error.code ?? 'generic', error.status);
		}
	}
</script>

<svelte:head>
	<title>{copy.login.title}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<AuthLayout illustration>
	{#if message?.kind === 'waitlisted'}
		<h1>{copy.waitlisted.heading}</h1>
		<p class="measure">{copy.waitlisted.bodyGoogle}</p>
		<p class="measure">{copy.waitlisted.nothingCreated}</p>
		<p class="links">
			{copy.waitlisted.wrongAccount}
			<a href={resolve('/login')} onclick={() => (message = null)}>{copy.waitlisted.useAnother}</a>
		</p>
	{:else}
		<h1>{copy.login.heading}</h1>
		<p class="measure">{copy.login.lede}</p>
		{#if message}
			<Notice title={message.title}><p>{message.body}</p></Notice>
		{/if}
		<GoogleButton
			label={copy.login.google}
			busyLabel={copy.login.googleBusy}
			busy={googleBusy}
			primary
			describedby="login-status"
			onclick={continueWithGoogle}
		/>
		<!-- Task 9: the "or use your email" rule and the email form go here. -->
		<p class="status" id="login-status" role="status" aria-live="polite">{status}</p>
		<noscript><p>{copy.login.noScript}</p></noscript>
	{/if}
	<p class="small muted"><a href={resolve('/')}>{copy.login.back}</a></p>
</AuthLayout>
