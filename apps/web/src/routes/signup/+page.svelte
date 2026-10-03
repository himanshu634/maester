<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { authContent as copy } from '$lib/content/auth';
	import { authClient } from '$lib/auth/client';
	import { messageFor, type AuthMessage } from '$lib/auth/messages';
	import {
		focusAfterFailure,
		focusFirstInvalid,
		validateEmail,
		validateName,
		validatePassword
	} from '$lib/auth/validate';
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
	let submitting = $state(false);
	let status = $state('');
	let name = $state('');
	let email = $state('');
	let password = $state('');
	let errors = $state<{ name: string | null; email: string | null; password: string | null }>({
		name: null,
		email: null,
		password: null
	});

	let waitlistedHeading = $state<HTMLHeadingElement>();
	let googleButton = $state<HTMLButtonElement>();
	let submitButton = $state<HTMLButtonElement>();

	// One action at a time: Google and the form lock each other out.
	const busy = $derived(googleBusy || submitting);
	const waitlisted = $derived(message?.kind === 'waitlisted');

	onMount(async () => {
		next = safeNext(page.url.searchParams.get('next'));
		// Google sends a refused sign-up back here with ?error=.
		message = messageFor(page.url.searchParams.get('error'));
		if (waitlisted) {
			// The page swapped to the waitlist view: put focus on its heading, so the change is announced.
			await tick();
			waitlistedHeading?.focus();
		}
		const session = await readSession(authClient());
		if (session.status === 'signed-in') {
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- next is a same-site path checked by safeNext
			goto(next, { replaceState: true });
		}
	});

	/** Show what went wrong and return focus to the button that sent the request. */
	async function fail(shown: AuthMessage | null, sentBy: () => HTMLButtonElement | undefined) {
		googleBusy = false;
		submitting = false;
		status = '';
		message = shown;
		await focusAfterFailure(sentBy);
	}

	async function continueWithGoogle() {
		if (busy) return;
		message = null;
		googleBusy = true;
		status = copy.signup.googleStatus;
		const errorCallbackURL = `/signup?next=${encodeURIComponent(next)}`;
		try {
			const { error } = await authClient().signIn.social({
				provider: 'google',
				callbackURL: next,
				errorCallbackURL
			});
			if (error) await fail(messageFor(error.code || 'generic', error.status), () => googleButton);
		} catch {
			// Network failure: the request never got an answer.
			await fail(messageFor('generic'), () => googleButton);
		}
	}

	async function create(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		message = null;
		status = '';
		errors = {
			name: validateName(name),
			email: validateEmail(email),
			password: validatePassword(password)
		};
		if (errors.name || errors.email || errors.password) {
			focusFirstInvalid(errors, { name: 'name', email: 'email', password: 'password' });
			return;
		}
		submitting = true;
		status = copy.signup.creating;
		const address = email.trim();
		try {
			const { error } = await authClient().signUp.email({
				name: name.trim(),
				email: address,
				password,
				callbackURL: verifyCallback(next)
			});
			if (error) {
				await fail(messageFor(error.code || 'generic', error.status), () => submitButton);
				return;
			}
		} catch {
			// Network failure: the request never got an answer.
			await fail(messageFor('generic'), () => submitButton);
			return;
		}
		// The answer is the same whether or not the address is on the invitation list,
		// so every sign-up goes on to the same page.
		// Stay busy until the next page has loaded, so a second click cannot send a second sign-up.
		const target = `${resolve('/verify-email')}?email=${encodeURIComponent(address)}&next=${encodeURIComponent(next)}`;
		try {
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- target is resolve() plus encodeURIComponent values; next is checked by safeNext
			await goto(target);
		} finally {
			submitting = false;
			status = '';
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
	<title>{waitlisted ? copy.waitlisted.title : copy.signup.title}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<AuthLayout>
	{#if waitlisted}
		<h1 tabindex="-1" bind:this={waitlistedHeading}>{copy.waitlisted.heading}</h1>
		<p class="measure">{copy.waitlisted.bodyGoogle}</p>
		<p class="measure">{copy.waitlisted.nothingCreated}</p>
		<p class="links">
			{copy.waitlisted.wrongAccount}
			<a href={resolve('/signup')} onclick={() => (message = null)}>{copy.waitlisted.useAnother}</a>
		</p>
	{:else}
		<h1>{copy.signup.heading}</h1>
		<p class="measure">{copy.signup.lede}</p>
		{#if message}
			<Notice title={message.title}><p>{message.body}</p></Notice>
		{/if}
		<GoogleButton
			label={copy.signup.google}
			busyLabel={copy.login.googleBusy}
			busy={googleBusy}
			disabled={busy}
			primary
			describedby="signup-status"
			onclick={continueWithGoogle}
			bind:element={googleButton}
		/>
		<OrRule label={copy.signup.or} />
		<form class="form" method="post" onsubmit={create} novalidate>
			<TextField
				id="name"
				label={copy.signup.name}
				autocomplete="name"
				bind:value={name}
				error={errors.name}
			/>
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
				autocomplete="new-password"
				hint={copy.signup.passwordHint}
				bind:value={password}
				error={errors.password}
			/>
			<div>
				<button class="button outline" type="submit" disabled={busy} bind:this={submitButton}>
					{submitting ? copy.signup.creating : copy.signup.create}
				</button>
			</div>
		</form>
		<p class="status" id="signup-status" role="status" aria-live="polite">{status}</p>
		<p class="links">
			{copy.signup.haveAccount}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the query string is built from an encodeURIComponent value; next is checked by safeNext -->
			<a href={`${resolve('/login')}?next=${encodeURIComponent(next)}`}>{copy.signup.signIn}</a>
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
</style>
