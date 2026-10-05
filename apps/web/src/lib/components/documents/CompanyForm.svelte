<!--
	Which company a filing belongs to. As a question (`ask`), when Maester found a company that
	is not in the workspace: add it as printed, which is the screen's one primary action, or pick
	one already added. As a change, from the slip's "Change": pick a company or add a new one.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { documentsContent as copy } from '$lib/content/documents';
	import { companyAnswer } from '$lib/documents/intake';
	import type { Classification, Company, CompanyAnswer } from '$lib/documents/types';
	import TextField from '$lib/components/auth/TextField.svelte';

	interface Props {
		mode: 'ask' | 'change';
		classification: Classification;
		companies: Company[];
		busy?: boolean;
		onsubmit: (answer: CompanyAnswer) => void;
		oncancel?: () => void;
	}

	let { mode, classification, companies, busy = false, onsubmit, oncancel }: Props = $props();

	const id = $props.id();
	const NEW = 'new';

	// Each form starts from the current answer and is the investor's from then on.
	const start = untrack(() => ({ classification, companies }));
	let picked = $state(start.classification.companyId ?? (start.companies.length === 0 ? NEW : ''));
	let name = $state(start.classification.companyNameAsPrinted ?? '');
	let nameError = $state<string | null>(null);
	let pickError = $state<string | null>(null);

	let printed = $derived(classification.companyNameAsPrinted?.trim() || null);

	function addNew(event?: SubmitEvent) {
		event?.preventDefault();
		if (!name.trim()) {
			nameError = copy.company.nameMissing;
			return;
		}
		nameError = null;
		onsubmit(companyAnswer(classification, name));
	}

	function usePicked(event: SubmitEvent) {
		event.preventDefault();
		if (picked === NEW) return addNew();
		if (!picked) {
			pickError = copy.company.pickMissing;
			return;
		}
		pickError = null;
		onsubmit({ id: picked });
	}
</script>

{#snippet picker(withNew: boolean)}
	<div class="field">
		<label for="{id}-pick">{withNew ? copy.company.changeLabel : copy.company.pickLabel}</label>
		<select
			id="{id}-pick"
			bind:value={picked}
			aria-invalid={pickError ? 'true' : undefined}
			aria-describedby={pickError ? `${id}-pick-error` : undefined}
		>
			{#if !withNew}
				<option value="" disabled>{copy.company.pickPlaceholder}</option>
			{/if}
			{#each companies as company (company.id)}
				<option value={company.id}>{company.displayName}</option>
			{/each}
			{#if withNew}
				<option value={NEW}>{copy.company.newOption}</option>
			{/if}
		</select>
		{#if pickError}<p class="error" id="{id}-pick-error">{pickError}</p>{/if}
	</div>
{/snippet}

{#if mode === 'ask'}
	<div class="ask">
		{#if printed}
			<button class="button" type="button" disabled={busy} onclick={() => addNew()}>
				{copy.company.add(printed)}
			</button>
		{:else}
			<form class="row" onsubmit={addNew} novalidate>
				<TextField
					id="{id}-name"
					label={copy.company.nameLabel}
					hint={copy.company.nameHint}
					autocomplete="organization"
					bind:value={name}
					error={nameError}
				/>
				<button class="button" type="submit" disabled={busy}>{copy.company.addNamed}</button>
			</form>
		{/if}
		{#if companies.length > 0}
			<form class="row" onsubmit={usePicked} novalidate>
				{@render picker(false)}
				<button class="button outline" type="submit" disabled={busy}>{copy.company.use}</button>
			</form>
		{/if}
	</div>
{:else}
	<form class="change" onsubmit={usePicked} novalidate>
		{@render picker(true)}
		{#if picked === NEW}
			<TextField
				id="{id}-name"
				label={copy.company.nameLabel}
				hint={copy.company.nameHint}
				autocomplete="organization"
				bind:value={name}
				error={nameError}
			/>
		{/if}
		<div class="actions">
			<button class="button outline" type="submit" disabled={busy}>{copy.kind.saveChange}</button>
			{#if oncancel}
				<button class="button outline" type="button" onclick={oncancel}>{copy.slip.cancel}</button>
			{/if}
		</div>
	</form>
{/if}

<style>
	.ask,
	.change {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-4);
		width: 100%;
	}

	.row {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-3);
		width: 100%;
		max-width: 28rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		width: 100%;
		max-width: 28rem;
	}

	label {
		font-weight: 700;
		font-size: var(--text-sm);
	}

	select {
		min-height: var(--target);
		padding: 0 var(--space-3);
		border: var(--rule) solid var(--ink);
		border-radius: var(--radius);
		background: var(--paper);
		color: var(--ink);
		font: inherit;
		font-size: 1rem;
	}

	select[aria-invalid='true'] {
		border-width: 3px;
	}

	.error {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
		font-weight: 700;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}

	.button {
		max-width: 100%;
		text-align: left;
	}
</style>
