<!--
	"Not in your workspace yet": each company a filing prints that is not in the workspace, once,
	however many files wait on it, then the files that print no company at all. A row adds the
	company as printed or says it is one of the investor's own; a company that matches one already
	added asks which. One filled button on the screen: the first row's, or with no rows the first
	unnamed file's "Say which company".
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { documentsContent as copy } from '$lib/content/documents';
	import {
		CONFIRM_SHOWN,
		confirmRequest,
		openerFilled,
		rowsToDraw,
		unnamedNotice,
		type ConfirmRow
	} from '$lib/documents/confirm';
	import { companyCandidates } from '$lib/documents/intake';
	import type {
		Company,
		CompanyAnswer,
		ConfirmCompanyRequest,
		DocumentClassification,
		FilingFile
	} from '$lib/documents/types';
	import { shortName } from '$lib/research/summary';
	import Notice from '$lib/components/auth/Notice.svelte';
	import TextField from '$lib/components/auth/TextField.svelte';
	import CompanyForm from './CompanyForm.svelte';

	interface Props {
		rows: ConfirmRow[];
		/** How many held companies are left out until "Show all". */
		more: number;
		expanded: boolean;
		lede: string;
		/** Files that print no company at all. */
		unnamed: FilingFile[];
		companies: Company[];
		/**
		 * The companies read has settled. Until then a row cannot tell whether it matches one of
		 * them, so no row is drawn (and no unnamed file offers its form).
		 */
		companiesLoaded: boolean;
		onexpand: () => void;
		/** Resolves true when the confirm was saved. `name` is the company's short name, for the page to say. */
		onconfirm: (request: ConfirmCompanyRequest, name: string, isNew: boolean) => Promise<boolean>;
		classificationOf: (documentId: string) => Promise<DocumentClassification | null>;
		/** Resolves true when the answer was saved. */
		onanswer: (documentId: string, basedOn: string, company: CompanyAnswer) => Promise<boolean>;
	}

	let {
		rows,
		more,
		expanded,
		lede,
		unnamed,
		companies,
		companiesLoaded,
		onexpand,
		onconfirm,
		classificationOf,
		onanswer
	}: Props = $props();

	const id = $props.id();

	let drawn = $derived(rowsToDraw(rows, companiesLoaded));
	let unnamedPrimary = $derived(rows.length === 0);

	// Each row's own state, by its identity key.
	let picking = $state<Record<string, boolean>>({});
	let picked = $state<Record<string, string>>({});
	let names = $state<Record<string, string>>({});
	let nameErrors = $state<Record<string, string | null>>({});
	let pickErrors = $state<Record<string, string | null>>({});
	let busy = $state<Record<string, boolean>>({});
	let failed = $state<Record<string, boolean>>({});

	// Each unnamed file's form, by its document id.
	let open = $state<Record<string, boolean>>({});
	let answers = $state.raw<Record<string, DocumentClassification | null>>({});
	let loadFailed = $state<Record<string, boolean>>({});

	const printedName = (row: ConfirmRow) => row.identity.nameAsPrinted?.trim() || null;
	const chosen = (row: ConfirmRow) => picked[row.identity.key] ?? row.matches[0]?.id ?? '';
	const showPicker = (row: ConfirmRow) => row.mode === 'pick' || picking[row.identity.key] === true;
	/** The matching companies first, then the rest. */
	const ordered = (row: ConfirmRow) => [
		...row.matches,
		...companies.filter((c) => !row.matches.some((m) => m.id === c.id))
	];

	function focusId(target: string) {
		document.getElementById(target)?.focus();
	}

	async function run(key: string, work: () => Promise<boolean>): Promise<boolean> {
		if (busy[key]) return false;
		busy[key] = true;
		failed[key] = false;
		try {
			const saved = await work();
			if (!saved) failed[key] = true;
			return saved;
		} finally {
			busy[key] = false;
		}
	}

	function add(row: ConfirmRow, event?: SubmitEvent) {
		event?.preventDefault();
		const key = row.identity.key;
		const name = printedName(row) ?? (names[key] ?? '').trim();
		if (!name) {
			nameErrors[key] = copy.company.nameMissing;
			focusId(`${id}-${key}-name`);
			return;
		}
		nameErrors[key] = null;
		run(key, () => onconfirm(confirmRequest(row.identity, { name }), shortName(name), true));
	}

	function use(row: ConfirmRow, event: SubmitEvent) {
		event.preventDefault();
		const key = row.identity.key;
		const company = companies.find((c) => c.id === chosen(row));
		if (!company) {
			pickErrors[key] = copy.company.pickMissing;
			focusId(`${id}-${key}-pick`);
			return;
		}
		pickErrors[key] = null;
		run(key, () =>
			onconfirm(
				confirmRequest(row.identity, { id: company.id }),
				shortName(company.displayName),
				false
			)
		);
	}

	async function toggleUnnamed(file: FilingFile) {
		const doc = file.documentId;
		if (open[doc]) {
			open[doc] = false;
			return;
		}
		loadFailed[doc] = false;
		open[doc] = true;
		if (answers[doc]) return;
		const read = await classificationOf(doc);
		if (read) {
			answers = { ...answers, [doc]: read };
		} else {
			open[doc] = false;
			loadFailed[doc] = true;
		}
	}

	async function answer(file: FilingFile, company: CompanyAnswer) {
		const doc = file.documentId;
		const read = answers[doc];
		if (!read) return;
		const saved = await run(`doc:${doc}`, () => onanswer(doc, read.classification.id, company));
		if (saved) {
			open[doc] = false;
			await tick();
		}
	}
</script>

{#snippet nameField(row: ConfirmRow)}
	<TextField
		id="{id}-{row.identity.key}-name"
		label={copy.company.nameLabel}
		hint={copy.company.nameHint}
		autocomplete="organization"
		bind:value={() => names[row.identity.key] ?? '', (v) => (names[row.identity.key] = v)}
		error={nameErrors[row.identity.key]}
	/>
{/snippet}

{#snippet addAction(row: ConfirmRow, filled: boolean, index: number)}
	{@const key = row.identity.key}
	{#if printedName(row)}
		<button
			class={['button', { outline: !filled }]}
			type="button"
			disabled={busy[key]}
			aria-describedby={busy[key] ? `${id}-${index}-saving` : undefined}
			onclick={() => add(row)}
		>
			{row.addLabel}
		</button>
	{:else}
		<form class="stack" onsubmit={(event) => add(row, event)} novalidate>
			{@render nameField(row)}
			<button
				class={['button', { outline: !filled }]}
				type="submit"
				disabled={busy[key]}
				aria-describedby={busy[key] ? `${id}-${index}-saving` : undefined}
			>
				{row.addLabel}
			</button>
		</form>
	{/if}
{/snippet}

{#snippet pickForm(row: ConfirmRow, filled: boolean, index: number)}
	{@const key = row.identity.key}
	<form class="stack" onsubmit={(event) => use(row, event)} novalidate>
		<div class="field">
			<label for="{id}-{key}-pick">{copy.confirm.pickerLabel}</label>
			<select
				id="{id}-{key}-pick"
				bind:value={() => chosen(row), (v) => (picked[key] = v)}
				aria-invalid={pickErrors[key] ? 'true' : undefined}
				aria-describedby={pickErrors[key] ? `${id}-${key}-pick-error` : undefined}
			>
				{#if row.mode === 'add'}
					<option value="" disabled>{copy.company.pickPlaceholder}</option>
				{/if}
				{#each ordered(row) as company (company.id)}
					<option value={company.id}>{company.displayName}</option>
				{/each}
			</select>
			{#if pickErrors[key]}<p class="error" id="{id}-{key}-pick-error">{pickErrors[key]}</p>{/if}
		</div>
		<button
			class={['button', { outline: !filled }]}
			type="submit"
			disabled={busy[key]}
			aria-describedby={busy[key] ? `${id}-${index}-saving` : undefined}
		>
			{copy.company.use}
		</button>
	</form>
{/snippet}

<section class="confirm" aria-labelledby="{id}-heading">
	<h2 id="{id}-heading">{copy.sections.confirm}</h2>
	<p class="lede">{lede}</p>

	{#if rows.length > 0 && !companiesLoaded}
		<p class="muted checking" role="status">{copy.confirm.checkingCompanies}</p>
	{/if}

	{#if drawn.length > 0}
		<ul class="rows">
			{#each drawn as row, index (row.identity.key)}
				{@const key = row.identity.key}
				<li>
					<div class="head">
						<h3 id="confirm-{key}" tabindex="-1">{row.title}</h3>
						<span class="counts num">{row.counts}</span>
					</div>
					{#if row.codes}<p class="codes muted">{row.codes}</p>{/if}
					{#if row.mode === 'pick'}
						<p class="question">{copy.company.questionCandidates}</p>
						{@render pickForm(row, row.primary, index)}
						{@render addAction(row, false, index)}
					{:else}
						<div class="actions">
							{@render addAction(row, row.primary, index)}
							<button
								class="button outline"
								type="button"
								aria-expanded={showPicker(row)}
								aria-controls="{id}-{key}-picker"
								disabled={busy[key]}
								onclick={() => (picking[key] = !picking[key])}
							>
								{copy.confirm.oneOfMine}
							</button>
						</div>
						{#if showPicker(row)}
							<div id="{id}-{key}-picker">{@render pickForm(row, false, index)}</div>
						{/if}
					{/if}
					{#if busy[key]}<p class="muted" id="{id}-{index}-saving">{copy.confirm.saving}</p>{/if}
					{#if failed[key]}<Notice title={copy.changeFailed.other} />{/if}
				</li>
			{/each}
		</ul>
		{#if more > 0}
			<p class="more">
				<span class="muted">{copy.confirm.more(more)}</span>
				<button class="text-button" type="button" onclick={onexpand}>{copy.confirm.showAll}</button>
			</p>
		{:else if expanded && rows.length > CONFIRM_SHOWN}
			<p class="more">
				<button class="text-button" type="button" onclick={onexpand}>
					{copy.confirm.showFewer}
				</button>
			</p>
		{/if}
	{/if}

	{#each unnamed as file, index (file.documentId)}
		{@const doc = file.documentId}
		{@const said = unnamedNotice(file)}
		{@const read = answers[doc]}
		<div class="unnamed" id="unnamed-{doc}" tabindex="-1">
			<Notice role="note" title={said.title}>
				<p>{said.detail}</p>
				<button
					class={[
						'button',
						{ outline: !openerFilled({ rows: rows.length, index, open: open[doc] === true }) }
					]}
					type="button"
					aria-expanded={open[doc] === true}
					aria-controls="{id}-unnamed-{doc}"
					disabled={busy[`doc:${doc}`]}
					onclick={() => toggleUnnamed(file)}
				>
					{copy.confirm.unnamedAction}
				</button>
				{#if loadFailed[doc]}<p class="error">{copy.confirm.answersFailed}</p>{/if}
				<div id="{id}-unnamed-{doc}">
					{#if open[doc]}
						{#if !read}
							<p class="muted" role="status">{copy.confirm.loadingAnswers}</p>
						{:else if !companiesLoaded}
							<p class="muted" role="status">{copy.confirm.checkingCompanies}</p>
						{:else}
							<CompanyForm
								mode="ask"
								classification={read.classification}
								{companies}
								candidates={companyCandidates(read.classification, companies)}
								busy={busy[`doc:${doc}`]}
								primary={unnamedPrimary && index === 0}
								onsubmit={(company) => answer(file, company)}
							/>
						{/if}
					{/if}
				</div>
				{#if busy[`doc:${doc}`]}<p class="muted">{copy.confirm.saving}</p>{/if}
				{#if failed[`doc:${doc}`]}<Notice title={copy.changeFailed.other} />{/if}
			</Notice>
		</div>
	{/each}
</section>

<style>
	.confirm {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
		container-type: inline-size;
	}

	h2 {
		font-stretch: var(--wdth-heading);
		font-weight: 700;
		font-size: var(--text-lg);
		line-height: var(--leading-heading);
		letter-spacing: var(--tracking-heading);
	}

	.lede,
	.checking {
		max-width: var(--measure);
	}

	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
		border-bottom: var(--rule) solid var(--ink);
	}

	li {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-3) 0 var(--space-4);
		border-top: var(--rule-thin) solid var(--ink-muted);
		font-size: 1rem;
		line-height: var(--leading-small);
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--space-1) var(--space-4);
		width: 100%;
	}

	h3 {
		font-size: 1rem;
		font-weight: 700;
		line-height: var(--leading-small);
		overflow-wrap: anywhere;
	}

	.counts {
		margin-left: auto;
		text-align: right;
	}

	.codes {
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}

	.question {
		font-weight: 700;
	}

	.actions,
	.stack {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: var(--space-3);
	}

	.stack {
		flex-direction: column;
		width: 100%;
		max-width: 28rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		width: 100%;
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

	.button {
		max-width: 100%;
		text-align: left;
	}

	.more {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}

	.text-button {
		min-height: var(--target);
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		font-weight: 700;
		text-decoration: underline;
		text-underline-offset: 3px;
		text-decoration-thickness: 1.5px;
		cursor: pointer;
	}

	.text-button:hover {
		background: var(--ink);
		color: var(--paper);
		text-decoration: none;
	}

	.unnamed {
		min-width: 0;
	}
</style>
