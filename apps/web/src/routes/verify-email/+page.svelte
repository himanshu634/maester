<script lang="ts">
	/**
	 * Two jobs: "check your email" after sign-up (?email=), and where the emailed link
	 * lands. Better Auth redirects here signed in when the link works, or with ?error=
	 * when it is spent. A successful email sign-in on /login also names this page as its
	 * callback. Whoever arrives signed in goes on to ?next=.
	 */
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { authContent as copy } from '$lib/content/auth';
	import { authClient } from '$lib/auth/client';
	import { messageFor, type AuthMessage } from '$lib/auth/messages';
	import { focusAfterFailure, focusFirstInvalid, validateEmail } from '$lib/auth/validate';
	import { readSession, safeNext, verifyCallback } from '$lib/session';
	import AuthLayout from '$lib/components/auth/AuthLayout.svelte';
	import Notice from '$lib/components/auth/Notice.svelte';
	import TextField from '$lib/components/auth/TextField.svelte';

	let next = $state('/terminal');
	let email = $state('');
	let view = $state<'sent' | 'expired'>('sent');
	let emailError = $state<string | null>(null);
	let message = $state<AuthMessage | null>(null);
	let sending = $state(false);
	let status = $state('');
	let expiredHeading = $state<HTMLHeadingElement>();
	// The one button that sends: "Send a new link" in the expired view, "Send it again" otherwise.
	let sendButton = $state<HTMLButtonElement>();

	// A usable address came in the query string, so "send it again" has somewhere to send.
	const canResend = $derived(email.trim() !== '' && validateEmail(email) === null);

	onMount(async () => {
		next = safeNext(page.url.searchParams.get('next'));
		email = page.url.searchParams.get('email') ?? '';
		// Whoever is signed in goes on, even from a link that was already spent: an expired
		// link must not strand someone the first visit already signed in.
		const session = await readSession(authClient());
		if (session.status === 'signed-in') {
			status = copy.verify.confirmed;
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- next is a same-site path checked by safeNext
			goto(next, { replaceState: true });
			return;
		}
		// Any non-empty error means the link did not work: INVALID_TOKEN, TOKEN_EXPIRED or
		// anything else. The value is never shown.
		if (page.url.searchParams.get('error')) {
			view = 'expired';
			// Put focus on the new heading, so the change is announced.
			await tick();
			expiredHeading?.focus();
		}
	});

	async function send(event?: SubmitEvent) {
		event?.preventDefault();
		if (sending) return;
		message = null;
		status = '';
		emailError = validateEmail(email);
		if (emailError) {
			focusFirstInvalid({ email: emailError }, { email: 'email' });
			return;
		}
		sending = true;
		status = copy.verify.sending;
		let failed = false;
		try {
			const { error } = await authClient().sendVerificationEmail({
				email: email.trim(),
				callbackURL: verifyCallback(next)
			});
			if (error) {
				message = messageFor(error.code || 'generic', error.status);
				status = '';
				failed = true;
			} else {
				status = copy.verify.sentAgain;
			}
		} catch {
			// Network failure: the request never got an answer.
			message = messageFor('generic');
			status = '';
			failed = true;
		} finally {
			sending = false;
		}
		if (failed) await focusAfterFailure(() => sendButton);
	}
</script>

<svelte:head>
	<title>{view === 'expired' ? copy.verify.expiredTitle : copy.verify.title}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<AuthLayout>
	{#if view === 'expired'}
		<h1 tabindex="-1" bind:this={expiredHeading}>{copy.verify.expiredHeading}</h1>
		<p class="measure">{copy.verify.expiredLede}</p>
		{#if message}
			<Notice title={message.title}><p>{message.body}</p></Notice>
		{/if}
		<form class="form" method="post" onsubmit={send} novalidate>
			<TextField
				id="email"
				label={copy.login.email}
				type="email"
				autocomplete="email"
				bind:value={email}
				error={emailError}
			/>
			<div>
				<button class="button" type="submit" disabled={sending} bind:this={sendButton}>
					{sending ? copy.verify.sending : copy.verify.sendNew}
				</button>
			</div>
		</form>
	{:else}
		<h1>{copy.verify.heading}</h1>
		<p class="measure">{canResend ? copy.verify.sent(email.trim()) : copy.verify.sentNoEmail}</p>
		{#if message}
			<Notice title={message.title}><p>{message.body}</p></Notice>
		{/if}
		{#if canResend}
			<Notice title={copy.verify.notArrived} role="note">
				<p>{copy.verify.notArrivedBody}</p>
				<button
					class="button outline"
					type="button"
					disabled={sending}
					onclick={() => send()}
					bind:this={sendButton}
				>
					{sending ? copy.verify.sending : copy.verify.sendAgain}
				</button>
			</Notice>
		{/if}
		<p class="links">
			{copy.verify.differentEmail}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the query string is built from an encodeURIComponent value; next is checked by safeNext -->
			<a href={`${resolve('/signup')}?next=${encodeURIComponent(next)}`}
				>{copy.verify.useDifferent}</a
			>
		</p>
	{/if}
	<p class="status" role="status" aria-live="polite">{status}</p>
	<p class="small muted"><a href={resolve('/')}>{copy.login.back}</a></p>
</AuthLayout>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
</style>
