<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { authContent as copy } from '$lib/content/auth';
	import { authClient } from '$lib/auth/client';
	import { messageFor, type AuthMessage } from '$lib/auth/messages';
	import { validateEmail, focusFirstInvalid } from '$lib/auth/validate';
	import { readSession, safeNext, verifyCallback } from '$lib/session';
	import AuthLayout from '$lib/components/auth/AuthLayout.svelte';
	import GoogleButton from '$lib/components/auth/GoogleButton.svelte';
	import Notice from '$lib/components/auth/Notice.svelte';
	import OrRule from '$lib/components/auth/OrRule.svelte';
	import TextField from '$lib/components/auth/TextField.svelte';
	import PasswordField from '$lib/components/auth/PasswordField.svelte';

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
		message = null;
		googleBusy = true;
		status = copy.login.googleStatus;
		const errorCallbackURL = `/login?next=${encodeURIComponent(next)}`;
		try {
			const { error } = await authClient().signIn.social({
				provider: 'google',
				callbackURL: next,
				errorCallbackURL
			});
			if (error) fail(messageFor(error.code || 'generic', error.status));
		} catch {
			// Network failure: the request never got an answer.
			fail(messageFor('generic'));
		}
	}

	function fail(shown: AuthMessage | null) {
		googleBusy = false;
		status = '';
		message = shown;
	}

	let email = $state('');
	let password = $state('');
	let errors = $state<{ email: string | null; password: string | null }>({
		email: null,
		password: null
	});
	let submitting = $state(false);
	let resending = $state(false);

	async function signIn(event: SubmitEvent) {
		event.preventDefault();
		message = null;
		errors = {
			email: validateEmail(email),
			// Only emptiness is checked: a stored password may predate today's length rule.
			password: password ? null : 'Enter your password.'
		};
		if (errors.email || errors.password) {
			focusFirstInvalid(errors, { email: 'email', password: 'password' });
			return;
		}
		submitting = true;
		status = copy.login.signingIn;
		try {
			const { error } = await authClient().signIn.email({
				email: email.trim(),
				password,
				callbackURL: verifyCallback(next)
			});
			if (error) {
				message = messageFor(error.code || 'generic', error.status);
				password = '';
				submitting = false;
				status = '';
				return;
			}
		} catch {
			// Network failure: the request never got an answer.
			message = messageFor('generic');
			password = '';
			submitting = false;
			status = '';
			return;
		}
		submitting = false;
		status = '';
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- next is a same-site path checked by safeNext
		goto(next, { replaceState: true });
	}

	async function resend() {
		resending = true;
		status = copy.login.resending;
		try {
			const { error } = await authClient().sendVerificationEmail({
				email: email.trim(),
				callbackURL: verifyCallback(next)
			});
			if (error) {
				message = messageFor(error.code || 'generic', error.status);
				status = '';
			} else {
				status = copy.login.resent;
			}
		} catch {
			message = messageFor('generic');
			status = '';
		} finally {
			resending = false;
		}
	}

	// Back from Google restores the page from the back/forward cache as it was left.
	function onpageshow(event: PageTransitionEvent) {
		if (event.persisted) {
			googleBusy = false;
			status = '';
		}
	}
</script>

<svelte:window {onpageshow} />

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
			<Notice title={message.title}>
				{#if message.kind === 'wrong-password'}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- /forgot-password arrives in Task 11; resolve() cannot type a route that does not exist yet -->
					<p>Try again, or <a href="/forgot-password">reset your password</a>.</p>
				{:else if message.kind === 'not-verified'}
					<p>{message.body}</p>
					<button class="button outline" type="button" disabled={resending} onclick={resend}>
						{resending ? copy.login.resending : copy.login.resend}
					</button>
				{:else}
					<p>{message.body}</p>
				{/if}
			</Notice>
		{/if}
		<GoogleButton
			label={copy.login.google}
			busyLabel={copy.login.googleBusy}
			busy={googleBusy}
			primary
			describedby="login-status"
			onclick={continueWithGoogle}
		/>
		<OrRule label={copy.login.or} />
		<form class="form" onsubmit={signIn} novalidate>
			<TextField
				id="email"
				label={copy.login.email}
				type="email"
				autocomplete="email"
				bind:value={email}
				error={errors.email}
			/>
			<PasswordField
				id="password"
				label={copy.login.password}
				autocomplete="current-password"
				bind:value={password}
				error={errors.password}
			/>
			<div class="actions">
				<button class="button outline" type="submit" disabled={submitting}>
					{submitting ? copy.login.signingIn : copy.login.signIn}
				</button>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- /forgot-password arrives in Task 11 -->
				<a href="/forgot-password">{copy.login.forgot}</a>
			</div>
		</form>
		<p class="status" id="login-status" role="status" aria-live="polite">{status}</p>
		<p class="links">
			{copy.login.newHere}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- /signup arrives in Task 10; next is checked by safeNext -->
			<a href="/signup?next={encodeURIComponent(next)}">{copy.login.createAccount}</a>
		</p>
		<noscript><p>{copy.login.noScript}</p></noscript>
	{/if}
	<p class="small muted"><a href={resolve('/')}>{copy.login.back}</a></p>
</AuthLayout>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-4);
	}

	.actions a {
		display: inline-flex;
		align-items: center;
		min-height: var(--target);
	}
</style>
