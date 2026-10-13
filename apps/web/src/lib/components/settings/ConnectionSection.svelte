<!--
	The body of one connection item. Not connected (or expired, failing, or being replaced): the
	form and, beside it from 1024px, where to find the key. Connected: what is kept (never the key
	itself, only its last 4), with "Replace" and "Disconnect". A save is checked with the source
	first and kept only if it passes; while it checks, "Save and check" is disabled and points at
	the line saying so. A refused field gets the fix under it and the focus.
-->
<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { settingsContent as copy } from '$lib/content/settings';
	import { ApiError } from '$lib/documents/client';
	import type { ConnectionsApi } from '$lib/settings/client';
	import type { Connection } from '$lib/settings/types';
	import {
		checkDhan,
		checkFred,
		expiredNote,
		failingNotice,
		expiryWords,
		lastReadWords,
		saveFailure,
		savedWords,
		type Failure
	} from '$lib/settings/view';
	import Notice from '$lib/components/auth/Notice.svelte';
	import PasswordField from '$lib/components/auth/PasswordField.svelte';
	import TextField from '$lib/components/auth/TextField.svelte';
	import Ruler from '$lib/components/loading/Ruler.svelte';
	import DisconnectDialog from './DisconnectDialog.svelte';

	interface Props {
		connection: Connection;
		api: ConnectionsApi;
		/** "Save and check" is the screen's one primary action. */
		primary: boolean;
		onsaved: (next: Connection) => void;
		onremoved: () => void;
	}

	let { connection, api, primary, onsaved, onremoved }: Props = $props();

	const id = $props.id();

	let replacing = $state(false);
	/** Starts from the saved client ID, so a renewal only needs the new token. */
	let clientId = $state(untrack(() => connection.clientId) ?? '');
	let secret = $state('');
	let busy = $state(false);
	let failure = $state<Failure | null>(null);
	let confirming = $state(false);
	let removing = $state(false);
	let removeFailed = $state(false);
	let clientInput = $state<HTMLInputElement>();
	let secretInput = $state<HTMLInputElement>();
	let replaceButton = $state<HTMLButtonElement>();

	let words = $derived(copy.providers[connection.provider]);
	let isDhan = $derived(connection.provider === 'dhan');
	let showForm = $derived(connection.state !== 'connected' || replacing);
	let fieldError = (field: Failure['field']) => (failure?.field === field ? failure.message : null);
	let secretWord = $derived(isDhan ? 'token' : 'key');

	async function focusFailure(f: Failure) {
		await tick();
		if (f.field === 'clientId') clientInput?.focus();
		else if (f.field) secretInput?.focus();
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		const local = isDhan ? checkDhan(clientId, secret) : checkFred(secret);
		if (local) {
			failure = local;
			await focusFailure(local);
			return;
		}
		failure = null;
		busy = true;
		try {
			const next = isDhan
				? await api.saveDhan({ clientId: clientId.trim(), accessToken: secret.trim() })
				: await api.saveFred({ apiKey: secret.trim() });
			secret = '';
			replacing = false;
			onsaved(next);
		} catch (err) {
			failure = saveFailure(
				err instanceof ApiError ? err : new ApiError(0, 'NETWORK', 'save failed'),
				connection.provider
			);
			await focusFailure(failure);
		} finally {
			busy = false;
		}
	}

	async function startReplacing() {
		replacing = true;
		failure = null;
		await tick();
		secretInput?.focus();
	}

	async function cancelReplacing() {
		replacing = false;
		secret = '';
		failure = null;
		await tick();
		replaceButton?.focus();
	}

	async function remove() {
		removing = true;
		removeFailed = false;
		try {
			await api.remove(connection.provider);
			confirming = false;
			onremoved();
		} catch {
			removeFailed = true;
			confirming = false;
		} finally {
			removing = false;
		}
	}
</script>

<div class={['body', { split: showForm }]}>
	<div class="main">
		{#if connection.state === 'expired'}
			<Notice title={copy.notices.expired.title} role="note">
				<p>{expiredNote(connection)}</p>
			</Notice>
		{:else if connection.state === 'failing'}
			{@const failing = failingNotice(connection)}
			<Notice title={failing.title} role="note">
				<p>{failing.detail}</p>
			</Notice>
		{/if}
		{#if connection.notice === 'DATA_PLAN_INACTIVE'}
			<Notice title={copy.notices.dataPlan.title} role="note">
				<p>{copy.notices.dataPlan.detail}</p>
			</Notice>
		{/if}

		{#if showForm}
			{#if connection.state === 'not_connected'}<p class="intro">{words.intro}</p>{/if}
			<form class="form" onsubmit={save} novalidate>
				{#if isDhan}
					<TextField
						id="{id}-client"
						label={copy.form.clientId}
						autocomplete="off"
						bind:value={clientId}
						bind:input={clientInput}
						error={fieldError('clientId')}
					/>
				{/if}
				<PasswordField
					id="{id}-secret"
					label={words.secretLabel}
					autocomplete="off"
					showLabel={words.showSecret}
					hint={copy.form.secretHint}
					bind:value={secret}
					bind:input={secretInput}
					error={fieldError(isDhan ? 'accessToken' : 'apiKey')}
				/>
				<div class="actions">
					<button
						type="submit"
						class={['button', { outline: !primary }]}
						disabled={busy}
						aria-describedby={busy ? `${id}-checking` : `${id}-note`}
					>
						{copy.form.save}
					</button>
					{#if replacing}
						<button type="button" class="button outline" onclick={cancelReplacing}>
							{copy.form.cancel}
						</button>
					{/if}
					{#if busy}
						<div class="checking" id="{id}-checking">
							<p>{words.checking}</p>
							<Ruler />
						</div>
					{:else}
						<p class="muted note" id="{id}-note">{words.saveNote}</p>
					{/if}
				</div>
				{#if failure && failure.field === null}
					<p class="form-error" role="alert">{failure.message}</p>
				{/if}
			</form>
		{:else}
			<dl>
				{#if isDhan}
					<div>
						<dt>{copy.connected.clientId}</dt>
						<dd class="num">{connection.clientId ?? '—'}</dd>
					</div>
				{/if}
				<div>
					<dt>{words.secretLabel}</dt>
					<dd>{savedWords(connection)}</dd>
				</div>
				{#if isDhan}
					<div>
						<dt>{copy.connected.expires}</dt>
						<dd>{connection.expiresAt ? expiryWords(connection.expiresAt) : '—'}</dd>
					</div>
				{/if}
				<div>
					<dt>{copy.connected.lastRead}</dt>
					<dd>{lastReadWords(connection)}</dd>
				</div>
			</dl>
			<div class="actions">
				<button
					type="button"
					class="button outline"
					bind:this={replaceButton}
					onclick={startReplacing}
				>
					{words.replace}
				</button>
				<button type="button" class="button outline" onclick={() => (confirming = true)}>
					{copy.connected.disconnect(words.name)}
				</button>
			</div>
			{#if removeFailed}
				<p class="form-error" role="alert">{copy.errors.disconnectFailed(words.name)}</p>
			{/if}
		{/if}
	</div>

	{#if showForm}
		<div class="steps">
			<h4>{copy.form.whereHeading}</h4>
			<ol>
				{#each words.steps as step, i (step)}
					<li><span class="n muted num">{i + 1}</span><span>{step}</span></li>
				{/each}
			</ol>
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- an external site, not an app route -->
			<a href={words.site.href} target="_blank" rel="noopener noreferrer">{words.site.label}</a>
		</div>
	{/if}
</div>

<DisconnectDialog
	bind:open={confirming}
	name={words.name}
	secret={secretWord}
	busy={removing}
	onconfirm={remove}
/>

<style>
	.body {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-8);
	}

	.main {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		min-width: 0;
	}

	.intro {
		max-width: var(--measure);
	}

	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		max-width: 30rem;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3) var(--space-4);
	}

	.note {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
		flex: 1 1 14rem;
	}

	.checking {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		flex: 1 1 12rem;
		font-size: var(--text-sm);
	}

	.form-error {
		font-weight: 700;
		font-size: var(--text-sm);
		line-height: var(--leading-small);
	}

	dl {
		margin: 0;
		border-top: var(--rule) solid var(--ink);
		border-bottom: var(--rule) solid var(--ink);
		max-width: 50rem;
	}

	dl div {
		display: grid;
		grid-template-columns: 8rem minmax(0, 1fr);
		gap: var(--space-4);
		padding: var(--space-3) 0;
	}

	dl div + div {
		border-top: var(--rule-thin) solid var(--ink-muted);
	}

	dt {
		font-weight: 700;
		font-size: 1rem;
		line-height: var(--leading-small);
	}

	dd {
		margin: 0;
		font-size: 1rem;
		line-height: var(--leading-small);
	}

	.steps {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
	}

	h4 {
		margin: 0;
		font-stretch: var(--wdth-heading);
		font-weight: 700;
		font-size: 1.125rem;
		line-height: 1.2;
	}

	ol {
		align-self: stretch;
		list-style: none;
		margin: 0;
		padding: 0;
		border-top: var(--rule) solid var(--ink);
		border-bottom: var(--rule) solid var(--ink);
	}

	li {
		display: grid;
		grid-template-columns: 1.75rem minmax(0, 1fr);
		gap: var(--space-2);
		padding: 10px 0;
		font-size: 1rem;
		line-height: var(--leading-small);
	}

	li + li {
		border-top: var(--rule-thin) solid var(--ink-muted);
	}

	@media (min-width: 1024px) {
		.body.split {
			grid-template-columns: minmax(0, 1fr) 26.25rem;
			gap: var(--space-14);
		}
	}
</style>
