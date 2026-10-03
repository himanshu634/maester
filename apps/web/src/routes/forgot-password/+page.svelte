<script lang="ts">
	import { resolve } from '$app/paths';
	import { authContent as copy } from '$lib/content/auth';
	import { authClient } from '$lib/auth/client';
	import { messageFor, type AuthMessage } from '$lib/auth/messages';
	import { focusAfterFailure, focusFirstInvalid, validateEmail } from '$lib/auth/validate';
	import AuthLayout from '$lib/components/auth/AuthLayout.svelte';
	import Notice from '$lib/components/auth/Notice.svelte';
	import TextField from '$lib/components/auth/TextField.svelte';

	let email = $state('');
	let error = $state<string | null>(null);
	let sending = $state(false);
	let status = $state('');
	let sentTo = $state<string | null>(null);
	let message = $state<AuthMessage | null>(null);
	let submitButton = $state<HTMLButtonElement>();

	async function send(event: SubmitEvent) {
		event.preventDefault();
		if (sending) return;
		message = null;
		sentTo = null;
		status = '';
		error = validateEmail(email);
		if (error) {
			focusFirstInvalid({ email: error }, { email: 'email' });
			return;
		}
		sending = true;
		status = copy.forgot.sending;
		const address = email.trim();
		try {
			// The answer is the same whether or not the address has an account: any response that is
			// not an error shows the same words, and the body is never read. A rate limit and a
			// failure are shown as what they are, because they say nothing about the address.
			const { error: failure } = await authClient().requestPasswordReset({
				email: address,
				redirectTo: '/reset-password'
			});
			if (failure) {
				message = messageFor(failure.code || 'generic', failure.status);
			} else {
				sentTo = address;
			}
		} catch {
			// Network failure: the request never got an answer.
			message = messageFor('generic');
		} finally {
			sending = false;
			status = '';
		}
		if (message) await focusAfterFailure(() => submitButton);
	}
</script>

<svelte:head>
	<title>{copy.forgot.title}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<AuthLayout>
	<h1>{copy.forgot.heading}</h1>
	<p class="measure">{copy.forgot.lede}</p>
	{#if sentTo}
		<Notice title={copy.forgot.sentTitle}><p>{copy.forgot.sent(sentTo)}</p></Notice>
	{/if}
	{#if message}
		<Notice title={message.kind === 'generic' ? copy.forgot.failedTitle : message.title}>
			<p>{message.body}</p>
		</Notice>
	{/if}
	<form class="form" method="post" onsubmit={send} novalidate>
		<TextField
			id="email"
			label={copy.login.email}
			type="email"
			autocomplete="email"
			bind:value={email}
			{error}
		/>
		<div>
			<button class="button" type="submit" disabled={sending} bind:this={submitButton}>
				{sending ? copy.forgot.sending : copy.forgot.send}
			</button>
		</div>
	</form>
	<p class="status" role="status" aria-live="polite">{status}</p>
	<p class="small"><a href={resolve('/login')}>{copy.forgot.backToSignIn}</a></p>
</AuthLayout>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
</style>
