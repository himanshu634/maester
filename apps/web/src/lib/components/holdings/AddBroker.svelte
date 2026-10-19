<!--
	Add a broker (A2): the brokers on the left, grouped into offered and not offered, and the
	chosen one's form on the right from 1024px (below it on smaller screens). Everything the form
	asks for, its numbered steps, how long a sign-in lasts and what it costs come from the broker's
	JSON definition. "Save and sign in with <broker>" keeps the key, then sends the browser to the
	broker's own login page; the broker sends it back to Holdings.
-->
<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { holdingsContent as copy } from '$lib/content/holdings';
	import { ApiError } from '$lib/documents/client';
	import type { HoldingsApi } from '$lib/holdings/client';
	import type { BrokerSummary } from '$lib/holdings/types';
	import PasswordField from '$lib/components/auth/PasswordField.svelte';
	import TextField from '$lib/components/auth/TextField.svelte';
	import Ruler from '$lib/components/loading/Ruler.svelte';

	interface Props {
		api: HoldingsApi;
		brokers: BrokerSummary[];
		/** The page is empty: this is the first broker, so there is nothing to cancel back to. */
		first?: boolean;
		oncancel: () => void;
	}

	let { api, brokers, first = false, oncancel }: Props = $props();

	const id = $props.id();
	const offered = $derived(brokers.filter((b) => b.enabled));
	const notOffered = $derived(brokers.filter((b) => !b.enabled));
	let chosenId = $state(untrack(() => brokers.find((b) => b.enabled)?.id ?? null));
	const chosen = $derived(offered.find((b) => b.id === chosenId) ?? null);
	let values = $state<Record<string, string>>({});
	let errors = $state<Record<string, string | undefined>>({});
	let formError = $state<string | null>(null);
	let busy = $state(false);
	let copied = $state(false);
	let inputs = $state<Record<string, HTMLInputElement | undefined>>({});

	async function choose(b: BrokerSummary) {
		chosenId = b.id;
		values = {};
		errors = {};
		formError = null;
		await tick();
		inputs[b.credentials[0]?.key ?? '']?.focus();
	}

	async function copyUrl(url: string) {
		try {
			await navigator.clipboard.writeText(url);
			copied = true;
		} catch {
			copied = false;
		}
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		const b = chosen;
		if (!b) return;
		const missing = b.credentials.filter((f) => !values[f.key]?.trim());
		errors = Object.fromEntries(missing.map((f) => [f.key, copy.add.enter(f.label)]));
		formError = null;
		if (missing.length) {
			inputs[missing[0]!.key]?.focus();
			return;
		}
		busy = true;
		try {
			await api.save(
				b.id,
				Object.fromEntries(b.credentials.map((f) => [f.key, values[f.key]!.trim()]))
			);
			values = {};
			window.location.assign(await api.signInUrl(b.id));
		} catch (err) {
			busy = false;
			if (err instanceof ApiError && err.fields.length) {
				errors = Object.fromEntries(
					err.fields.map((f) => [f.path.replace(/^credentials\./, ''), f.message])
				);
				await tick();
				inputs[err.fields[0]!.path.replace(/^credentials\./, '')]?.focus();
			} else {
				formError = copy.errors.BROKER_UNAVAILABLE!('Maester');
			}
		}
	}
</script>

<section class="add" aria-labelledby="{id}-heading">
	<h2 id="{id}-heading">{first ? copy.add.which : copy.add.heading}</h2>
	<div class="split">
		<div class="picker">
			{#if !first}<h3>{copy.add.which}</h3>{/if}
			<ul>
				{#each offered as b (b.id)}
					<li>
						<button
							type="button"
							class="pick"
							aria-pressed={b.id === chosenId}
							onclick={() => choose(b)}
						>
							<span class="name">{b.name}</span>
							<span class="line">{b.copy.pickerLine}</span>
							<span class="cost num">{b.copy.cost}</span>
						</button>
					</li>
				{/each}
			</ul>
			{#if notOffered.length}
				<h4>{copy.add.notOffered}</h4>
				<ul>
					{#each notOffered as b (b.id)}
						<li class="off">
							<span class="name">{b.name}</span>
							<span class="line muted">{b.notOfferedReason ?? b.copy.pickerLine}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		{#if chosen}
			<form class="form" onsubmit={save} novalidate aria-labelledby="{id}-form">
				<h3 id="{id}-form">{copy.add.connect(chosen.name)}</h3>
				<p class="lede">{chosen.copy.formLede}</p>
				<ol class="steps">
					{#each chosen.copy.steps as step, i (step)}
						<li><span class="n num">{i + 1}</span><span>{step}</span></li>
					{/each}
				</ol>

				<div class="field">
					<label for="{id}-return">{copy.add.returnUrl}</label>
					<p class="hint" id="{id}-return-hint">{copy.add.returnUrlHint}</p>
					<div class="copyrow">
						<input
							id="{id}-return"
							readonly
							value={chosen.returnUrl}
							aria-describedby="{id}-return-hint"
						/>
						<button type="button" class="button outline" onclick={() => copyUrl(chosen.returnUrl)}
							>{copy.add.copy}</button
						>
					</div>
					<p class="hint" role="status">{copied ? copy.add.copied : ''}</p>
				</div>

				{#each chosen.credentials as f (f.key)}
					{#if f.secret}
						<PasswordField
							id="{id}-{f.key}"
							label={f.label}
							autocomplete="off"
							showLabel="Show {f.label.toLowerCase()}"
							hint={f.hint}
							bind:value={values[f.key]}
							bind:input={inputs[f.key]}
							error={errors[f.key]}
						/>
					{:else}
						<TextField
							id="{id}-{f.key}"
							label={f.label}
							autocomplete="off"
							hint={f.hint}
							bind:value={values[f.key]}
							bind:input={inputs[f.key]}
							error={errors[f.key]}
						/>
					{/if}
				{/each}

				<dl>
					<div>
						<dt>{copy.add.lasts}</dt>
						<dd>{chosen.copy.lasts}</dd>
					</div>
					<div>
						<dt>{copy.add.cost}</dt>
						<dd>{chosen.copy.cost}</dd>
					</div>
				</dl>

				<div class="actions">
					<button
						type="submit"
						class="button"
						disabled={busy}
						aria-describedby={busy ? `${id}-saving` : `${id}-note`}
					>
						{copy.add.save(chosen.name)}
					</button>
					{#if !first}
						<button type="button" class="button outline" onclick={oncancel}
							>{copy.add.cancel}</button
						>
					{/if}
				</div>
				{#if busy}
					<div class="saving" id="{id}-saving">
						<p>{copy.add.saving}</p>
						<Ruler />
					</div>
				{:else if chosen.copy.saveNote}
					<p class="muted note" id="{id}-note">{chosen.copy.saveNote}</p>
				{/if}
				{#if formError}<p class="form-error" role="alert">{formError}</p>{/if}
			</form>
		{/if}
	</div>
</section>

<style>
	.add {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		border-top: var(--rule) solid var(--ink);
		padding-top: var(--space-5);
	}

	h2 {
		font-stretch: var(--wdth-heading);
		font-weight: 700;
		font-size: 1.375rem;
		line-height: 1.1;
		letter-spacing: var(--tracking-heading);
	}

	h3 {
		font-stretch: var(--wdth-heading);
		font-weight: 700;
		font-size: 1.25rem;
		line-height: 1.2;
	}

	h4 {
		font-weight: 700;
		font-size: 1rem;
		margin-top: var(--space-4);
	}

	.split {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-8);
	}

	ul {
		list-style: none;
		margin: var(--space-2) 0 0;
		padding: 0;
		border-top: var(--rule) solid var(--ink);
	}

	li + li {
		border-top: var(--rule-thin) solid var(--ink-muted);
	}

	.pick {
		display: grid;
		grid-template-columns: 8rem minmax(0, 1fr) auto;
		gap: var(--space-3);
		align-items: baseline;
		width: 100%;
		min-height: 48px;
		padding: var(--space-2) var(--space-3);
		border: 0;
		background: transparent;
		color: var(--ink);
		text-align: left;
		font: inherit;
		cursor: pointer;
	}

	.pick[aria-pressed='true'] {
		background: var(--ink);
		color: var(--paper);
	}

	.pick:not([aria-pressed='true']):hover {
		outline: var(--rule) solid var(--ink);
		outline-offset: calc(-1 * var(--rule));
	}

	.off {
		display: grid;
		grid-template-columns: 8rem minmax(0, 1fr);
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		color: var(--ink-muted);
	}

	.name {
		font-weight: 700;
	}

	.line,
	.cost {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
	}

	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		max-width: 34rem;
		min-width: 0;
	}

	.lede {
		max-width: var(--measure);
	}

	.steps {
		list-style: none;
		margin: 0;
		padding: 0;
		border-top: var(--rule) solid var(--ink);
		border-bottom: var(--rule) solid var(--ink);
	}

	.steps li {
		display: grid;
		grid-template-columns: 1.75rem minmax(0, 1fr);
		gap: var(--space-2);
		padding: 10px 0;
		font-size: 1rem;
		line-height: var(--leading-small);
	}

	.n {
		font-weight: 700;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	label {
		font-weight: 700;
	}

	.hint {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
		color: var(--ink-muted);
	}

	.copyrow {
		display: flex;
		min-width: 0;
	}

	.copyrow input {
		flex: 1;
		min-width: 0;
		min-height: 44px;
		padding: 0 12px;
		border: var(--rule) solid var(--ink);
		border-right: 0;
		background: var(--paper);
		color: var(--ink);
		font: inherit;
		font-size: 1rem;
	}

	dl {
		margin: 0;
		border-top: var(--rule) solid var(--ink);
		border-bottom: var(--rule) solid var(--ink);
	}

	dl div {
		display: grid;
		grid-template-columns: 9rem minmax(0, 1fr);
		gap: var(--space-4);
		padding: var(--space-3) 0;
	}

	dl div + div {
		border-top: var(--rule-thin) solid var(--ink-muted);
	}

	dt {
		font-weight: 700;
	}

	dd {
		margin: 0;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3) var(--space-4);
	}

	.saving {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		font-size: var(--text-sm);
	}

	.note,
	.form-error {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
	}

	.form-error {
		font-weight: 700;
	}

	@media (min-width: 1024px) {
		.split {
			grid-template-columns: minmax(0, 30rem) minmax(0, 1fr);
			gap: var(--space-12);
		}
	}
</style>
