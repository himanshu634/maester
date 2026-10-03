<script lang="ts">
	/**
	 * Where the emailed reset link lands: /reset-password?token=… or ?error=… . The single-use
	 * token is read once, kept in memory and removed from the address bar, so it does not sit
	 * in history or travel in a Referer header.
	 */
	import { onMount, tick } from 'svelte';
	import { goto, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { authContent as copy } from '$lib/content/auth';
	import { authClient } from '$lib/auth/client';
	import { messageFor, type AuthMessage } from '$lib/auth/messages';
	import { focusAfterFailure, focusFirstInvalid, validatePassword } from '$lib/auth/validate';
	import { safeNext } from '$lib/session';
	import AuthLayout from '$lib/components/auth/AuthLayout.svelte';
	import Notice from '$lib/components/auth/Notice.svelte';
	import PasswordField from '$lib/components/auth/PasswordField.svelte';

	let token = $state<string | null>(null);
	let next = $state<string | null>(null);
	let expired = $state(false);
	let password = $state('');
	let error = $state<string | null>(null);
	let saving = $state(false);
	let status = $state('');
	let message = $state<AuthMessage | null>(null);
	let expiredHeading = $state<HTMLHeadingElement>();
	let submitButton = $state<HTMLButtonElement>();

	/** Switch to the expired view and put focus on its heading, so the change is announced. */
	async function showExpired() {
		expired = true;
		await tick();
		expiredHeading?.focus();
	}

	onMount(async () => {
		const params = page.url.searchParams;
		token = params.get('token');
		const nextParam = params.get('next');
		next = nextParam === null ? null : safeNext(nextParam);
		// A missing token or any non-empty error (INVALID_TOKEN, TOKEN_EXPIRED, …) means the link
		// did not work. The error value is never shown.
		expired = !token || !!params.get('error');
		// Take the token and error out of the address bar; keep next.
		const clean = new URL(page.url);
		clean.searchParams.delete('token');
		clean.searchParams.delete('error');
		const cleaned = clean.pathname + clean.search + clean.hash;
		// The router finishes starting just after the first mount; replaceState throws before that.
		await tick();
		try {
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- same page, same origin: only the query string changes
			replaceState(cleaned, page.state);
		} catch {
			// SvelteKit throws if its router has not started yet. Whatever the reason, the token
			// must still leave the address bar, so fall back to the browser's own history API.
			history.replaceState(history.state, '', cleaned);
		}
		expiredHeading?.focus();
	});

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (saving) return;
		message = null;
		status = '';
		error = validatePassword(password);
		if (error) {
			focusFirstInvalid({ password: error }, { password: 'password' });
			return;
		}
		if (!token) {
			await showExpired();
			return;
		}
		saving = true;
		status = copy.reset.setting;
		try {
			const { error: failure } = await authClient().resetPassword({
				newPassword: password,
				token
			});
			if (failure) {
				const shown = messageFor(failure.code || 'generic', failure.status);
				saving = false;
				status = '';
				if (shown?.kind === 'link-expired') {
					await showExpired();
				} else {
					message = shown;
					await focusAfterFailure(() => submitButton);
				}
				return;
			}
		} catch {
			// Network failure: the request never got an answer.
			message = messageFor('generic');
			saving = false;
			status = '';
			await focusAfterFailure(() => submitButton);
			return;
		}
		// Stay busy until /login has loaded, so a second click cannot spend the link again.
		const target = `${resolve('/login')}?reset=done${next ? `&next=${encodeURIComponent(next)}` : ''}`;
		try {
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- target is resolve() plus an encodeURIComponent value; next is checked by safeNext
			await goto(target, { replaceState: true });
		} finally {
			saving = false;
			status = '';
		}
	}
</script>

<svelte:head>
	<title>{copy.reset.title}</title>
	<meta name="robots" content="noindex" />
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<AuthLayout>
	{#if expired}
		<h1 tabindex="-1" bind:this={expiredHeading}>{copy.reset.expiredHeading}</h1>
		<p class="measure">{copy.reset.expiredLede}</p>
		<p><a class="button" href={resolve('/forgot-password')}>{copy.reset.requestNew}</a></p>
	{:else}
		<h1>{copy.reset.heading}</h1>
		{#if message}
			<Notice title={message.kind === 'generic' ? copy.reset.failedTitle : message.title}>
				<p>{message.body}</p>
			</Notice>
		{/if}
		<form class="form" method="post" onsubmit={save} novalidate>
			<PasswordField
				id="password"
				label={copy.reset.newPassword}
				autocomplete="new-password"
				hint={copy.signup.passwordHint}
				bind:value={password}
				{error}
			/>
			<div>
				<button class="button" type="submit" disabled={saving} bind:this={submitButton}>
					{saving ? copy.reset.setting : copy.reset.set}
				</button>
			</div>
		</form>
		<p class="status" role="status" aria-live="polite">{status}</p>
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
