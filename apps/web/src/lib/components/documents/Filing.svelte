<!--
	The filing opened: one filing of one company, where it stands and what Maester read it as. A 2px
	box with its heading, the Numbers track, each statement's source per basis (where the numbers
	come from, and whether the XBRL's figures are on the PDF), the Text track, the files, whatever
	needs the investor, "Read as" for each file, then the actions. The working track is an ink block
	here and a check that missed something is bold. Never a confidence.
-->
<script module lang="ts">
	import type { ChangeClassificationRequest } from '$lib/documents/types';

	export type Change = Omit<ChangeClassificationRequest, 'basedOn'>;
</script>

<script lang="ts">
	import { tick } from 'svelte';
	import { documentsContent as copy } from '$lib/content/documents';
	import { filingHeading, filingMeta, type FilingView } from '$lib/documents/filings';
	import {
		addedAt,
		kindChoices,
		kindSaveLabel,
		periodWords,
		sourceOf,
		statementsWords,
		whatItIs
	} from '$lib/documents/intake';
	import { readAgainIds, retryIds, sourceRows, basisTitle } from '$lib/documents/sources';
	import { textTrack, type TrackContext } from '$lib/documents/tracks';
	import type {
		Company,
		CompanyAnswer,
		DocumentClassification,
		FilingFile
	} from '$lib/documents/types';
	import Notice from '$lib/components/auth/Notice.svelte';
	import SectionIssue from '$lib/components/errors/SectionIssue.svelte';
	import { companyHref } from '$lib/research/links';
	import Track from './Track.svelte';
	import KindForm, { type KindAnswer } from './KindForm.svelte';
	import CompanyForm from './CompanyForm.svelte';

	interface Props {
		view: FilingView;
		/** The filing's company, once it is known and its name has loaded. */
		company: Company | null;
		companies: Company[];
		/** Each file's current answers, by document id; null while they are not known. */
		answers: Record<string, DocumentClassification | null>;
		/** Documents whose answers Maester has but did not load. */
		answersFailed: readonly string[];
		ctx: TrackContext;
		/** This filing's own question may take the screen's one primary action. */
		primaryAvailable: boolean;
		/** What happened to the investor's last action here, when it did not work. */
		message: string | null;
		/** The address of a stored file (a route that redirects to the PDF). */
		fileHref: (id: string) => string;
		/** Resolves true when the change was saved. */
		onchange: (documentId: string, change: Change) => Promise<boolean>;
		onretry: (track: 'identify' | 'numbers' | 'text') => Promise<void>;
		onreadagain: () => Promise<void>;
		/** Load the answers again. Resolves true when they loaded. */
		onreload: () => Promise<boolean>;
		/** The heading, so the page can move focus here when a filing is opened. */
		heading?: HTMLHeadingElement;
	}

	let {
		view,
		company,
		companies,
		answers,
		answersFailed,
		ctx,
		primaryAvailable,
		message,
		fileHref,
		onchange,
		onretry,
		onreadagain,
		onreload,
		heading = $bindable()
	}: Props = $props();

	type Field = 'kind' | 'company';

	const id = $props.id();
	/** The answer being changed, and the set of answers the form was opened on. */
	let editingFor = $state<{ documentId: string; field: Field; answerId: string } | null>(null);
	let busy = $state(false);
	/** Which retry is running ("Try again", "Read it again"); apart from saving a change. */
	let retrying = $state<'identify' | 'numbers' | 'text' | 'again' | 'reload' | null>(null);
	/** What the last "Try again" on unloaded answers came to. */
	let reloadOutcome = $state('');
	/** The Change buttons, so focus can go back to the one that opened a form. */
	let changeButtons = $state<Record<string, HTMLButtonElement | null>>({});

	let files = $derived(view.files);
	let sources = $derived(view.filing?.sources ?? []);
	let headingText = $derived(
		filingHeading(company?.displayName ?? null, view.title, view.filing?.kind ?? null)
	);
	let meta = $derived(filingMeta(view));
	let text = $derived(textTrack(files, ctx, 'opened'));

	/** The PDF whose statements the ledger falls back on, as the sources do. */
	let pdfStatements = $derived.by(() => {
		const pdf = files.find(
			(f) => f.format === 'pdf' && f.state === 'stored' && f.intakeState !== 'duplicate'
		);
		return pdf ? (answers[pdf.documentId]?.classification.statementsFound ?? null) : null;
	});
	let bases = $derived(
		view.filing
			? sources
					.map((basis) => ({
						basis: basis.basis,
						rows: sourceRows(basis, view.filing as NonNullable<FilingView['filing']>, pdfStatements)
					}))
					.filter((b) => b.rows.length > 0)
			: []
	);

	let numbersRetry = $derived.by((): 'identify' | 'numbers' | null => {
		if (view.numbers.state !== 'stopped') return null;
		if (retryIds(files, sources, 'identify').length > 0) return 'identify';
		if (retryIds(files, sources, 'numbers').length > 0) return 'numbers';
		return null;
	});
	let textRetry = $derived(text.state === 'stopped' && retryIds(files, sources, 'text').length > 0);
	let canReadAgain = $derived(
		readAgainIds(files, sources).length > 0 && view.numbers.state !== 'now' && text.state !== 'now'
	);
	let seeFigures = $derived(view.companyId !== null && view.numbers.state === 'done');

	/** The files that have answers of their own to show: stored, and not a copy of another. */
	let readable = $derived(
		files.filter((f) => f.state === 'stored' && f.intakeState !== 'duplicate')
	);
	let questions = $derived(
		files.filter((f) => f.intakeState === 'needs_kind' && answers[f.documentId])
	);

	const label = (file: FilingFile) =>
		`${copy.titles.format[file.format]}${copy.titles.separator}${file.originalName}`;

	async function run<T>(work: () => Promise<T>): Promise<T | undefined> {
		if (busy) return undefined;
		busy = true;
		try {
			return await work();
		} finally {
			busy = false;
		}
	}

	async function retry(kind: NonNullable<typeof retrying>, work: () => Promise<unknown>) {
		if (retrying) return;
		retrying = kind;
		try {
			await work();
		} finally {
			retrying = null;
		}
	}

	/** Try loading the answers again; say so when they still did not load, even if nothing else moved. */
	async function reload() {
		reloadOutcome = '';
		let loaded = false;
		await retry('reload', async () => {
			loaded = await onreload();
		});
		if (!loaded) {
			await tick();
			reloadOutcome = copy.answersFailed.again;
		}
	}

	/**
	 * Save a change. Focus then goes back to the Change button that opened the form, or to the
	 * heading when the question that held the form has been answered and is gone. A file that
	 * leaves this filing is followed by the page, which opens the filing it went to.
	 */
	async function change(documentId: string, next: Change, from: Field | 'question') {
		const saved = await run(() => onchange(documentId, next));
		if (!saved) return;
		editingFor = null;
		await tick();
		const button = from === 'question' ? null : changeButtons[`${documentId}:${from}`];
		if (button?.isConnected) button.focus();
		else heading?.focus();
	}

	const kindFrom = (documentId: string, from: 'kind' | 'question') => (answer: KindAnswer) =>
		change(
			documentId,
			{ kind: answer.kind, otherType: answer.otherType, resultsSpan: answer.resultsSpan },
			from
		);
	const companyFrom = (documentId: string) => (company: CompanyAnswer) =>
		change(documentId, { company }, 'company');

	function toggle(documentId: string, field: Field) {
		const current = answers[documentId];
		if (!current) return;
		const open = editingFor?.documentId === documentId && editingFor.field === field;
		editingFor = open ? null : { documentId, field, answerId: current.classification.id };
	}
</script>

{#snippet sourceLine(text: string | null)}
	{#if text}
		<span class="source">{text}</span>
	{:else}
		<span class="source"
			><span aria-hidden="true">—</span><span class="visually-hidden">{copy.filing.noSource}</span
			></span
		>
	{/if}
{/snippet}

{#snippet changeButton(file: FilingFile, field: Field, term: string, editing: boolean)}
	<button
		class="text-button"
		type="button"
		aria-expanded={editing}
		aria-controls="{id}-{file.documentId}-{field}-form"
		aria-label={copy.filing.changeLabel(term)}
		bind:this={changeButtons[`${file.documentId}:${field}`]}
		onclick={() => toggle(file.documentId, field)}>{copy.filing.change}</button
	>
{/snippet}

{#snippet retryButton(
	kind: NonNullable<typeof retrying>,
	name: string,
	work: () => Promise<unknown>
)}
	<button
		class="button outline"
		type="button"
		disabled={retrying !== null}
		aria-describedby={retrying === kind ? `${id}-${name}-busy` : undefined}
		onclick={() => retry(kind, work)}
	>
		{name === 'again' ? copy.filing.readAgain : copy.filing.tryAgain}
	</button>
	{#if retrying === kind}<p class="busy-note" id="{id}-{name}-busy">{copy.retrying}</p>{/if}
{/snippet}

{#snippet readAsFile(file: FilingFile)}
	{@const doc = answers[file.documentId] ?? null}
	{@const current = doc?.classification ?? null}
	{@const evidence = doc?.evidence ?? []}
	{@const companyId = current?.companyId ?? view.companyId}
	{@const companyName = companyId
		? (companies.find((c) => c.id === companyId)?.displayName ?? null)
		: null}
	{@const printed = current?.companyNameAsPrinted?.trim() || null}
	{@const kind = whatItIs(current)}
	{@const period = current ? periodWords(current) : '—'}
	{@const statements = current ? statementsWords(current.statementsFound) : '—'}
	{@const companyValue = companyName ?? (companyId ? '—' : (printed ?? '—'))}
	{@const open =
		editingFor && editingFor.documentId === file.documentId && editingFor.answerId === current?.id
			? editingFor.field
			: null}
	{@const failed = answersFailed.includes(file.documentId) && !current}
	<section class="file" aria-labelledby="{id}-{file.documentId}-name">
		<h4 id="{id}-{file.documentId}-name">{label(file)}</h4>
		{#if failed}
			<SectionIssue
				role="note"
				title={copy.answersFailed.title}
				detail={copy.answersFailed.detail}
				retryLabel={copy.answersFailed.retry}
				busy={retrying === 'reload' ? copy.retrying : null}
				outcome={reloadOutcome}
				onretry={reload}
			/>
		{:else}
			{#if !current}
				<p class="muted not-yet">{copy.filing.notYet}</p>
			{/if}
			<dl class="spec">
				<div class="entry">
					<dt>{copy.filing.terms.kind}</dt>
					<dd>
						<span class="value">{kind}</span>
						<span class="meta">
							{#if current && kind !== '—'}{@render sourceLine(sourceOf(evidence, 'kind'))}{/if}
							{#if current && file.intakeState !== 'needs_kind'}
								{@render changeButton(file, 'kind', copy.filing.terms.kind, open === 'kind')}
							{/if}
						</span>
						{#if open === 'kind' && current}
							<div class="edit" id="{id}-{file.documentId}-kind-form">
								<KindForm
									initial={current}
									kinds={kindChoices(file.format)}
									submitLabel={copy.kind.saveChange}
									{busy}
									onsubmit={kindFrom(file.documentId, 'kind')}
									oncancel={() => (editingFor = null)}
								/>
							</div>
						{/if}
					</dd>
				</div>
				<div class="entry">
					<dt>{copy.filing.terms.company}</dt>
					<dd>
						<span class="value">{companyValue}</span>
						{#if current && !companyId && printed}
							<span class="source">{copy.filing.notConfirmed}</span>
						{/if}
						<span class="meta">
							{#if current && companyValue !== '—'}{@render sourceLine(
									sourceOf(evidence, 'company')
								)}{/if}
							{#if current}
								{@render changeButton(
									file,
									'company',
									copy.filing.terms.company,
									open === 'company'
								)}
							{/if}
						</span>
						{#if open === 'company' && current}
							<div class="edit" id="{id}-{file.documentId}-company-form">
								<CompanyForm
									mode="change"
									classification={current}
									{companies}
									{busy}
									onsubmit={companyFrom(file.documentId)}
									oncancel={() => (editingFor = null)}
								/>
							</div>
						{/if}
					</dd>
				</div>
				<div class="entry">
					<dt>{copy.filing.terms.period}</dt>
					<dd>
						<span class="value">{period}</span>
						{#if current && period !== '—'}{@render sourceLine(sourceOf(evidence, 'period'))}{/if}
					</dd>
				</div>
				<div class="entry">
					<dt>{copy.filing.terms.statements}</dt>
					<dd>
						<span class="value">{statements}</span>
						{#if current && statements !== '—'}{@render sourceLine(
								sourceOf(evidence, 'statements')
							)}{/if}
					</dd>
				</div>
			</dl>
		{/if}
	</section>
{/snippet}

<article class="filing" aria-labelledby="{id}-name">
	<header class="head">
		<h2 id="{id}-name" tabindex="-1" bind:this={heading}>{headingText}</h2>
		<p class="meta-line muted">{meta}</p>
	</header>

	<div class="body">
		<div class="box">
			<Track label={copy.filing.numbers} words={view.numbers} ink>
				{#if numbersRetry}
					{@const kind = numbersRetry}
					<div class="actions">
						{@render retryButton(kind, 'numbers', () => onretry(kind))}
					</div>
				{/if}
			</Track>
		</div>

		{#each bases as { basis, rows } (basis)}
			<section class="sources" aria-labelledby="{id}-{basis}-title">
				<h3 id="{id}-{basis}-title">{basisTitle(basis)}</h3>
				<div class="ledger" role="table" aria-labelledby="{id}-{basis}-title">
					<div class="row head-row visually-hidden" role="row">
						<span role="columnheader">{copy.filing.columns.statement}</span>
						<span role="columnheader">{copy.filing.columns.from}</span>
						<span role="columnheader">{copy.filing.columns.inPdf}</span>
					</div>
					{#each rows as row (row.statement)}
						<div class="row" role="row">
							<span role="cell" class="statement">{row.label}</span>
							<span role="cell" class="cell">
								<span class="col-name muted" aria-hidden="true">{copy.filing.columns.from}</span>
								<span>{row.from.text}</span>
								{#if row.from.note}<span class="muted note">{row.from.note}</span>{/if}
							</span>
							<span role="cell" class="cell">
								<span class="col-name muted" aria-hidden="true">{copy.filing.columns.inPdf}</span>
								<span class:strong={row.inPdf.strong}>{row.inPdf.text}</span>
								{#if row.inPdf.missed}<span class="note">{row.inPdf.missed}</span>{/if}
								{#if row.inPdf.open}
									{@const href = `${fileHref(row.inPdf.open.documentId)}#page=${row.inPdf.open.pageIndex + 1}`}
									<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- an API route that redirects to the stored PDF -->
									<a class="note" {href} target="_blank" rel="noopener">{row.inPdf.open.label}</a>
								{/if}
							</span>
						</div>
					{/each}
				</div>
			</section>
		{/each}

		<div class="box">
			<Track label={copy.filing.text} words={text} ink>
				{#if textRetry}
					<div class="actions">
						{@render retryButton('text', 'text', () => onretry('text'))}
					</div>
				{/if}
			</Track>
		</div>

		<dl class="spec">
			<div class="entry">
				<dt>{copy.filing.files}</dt>
				<dd>
					<ul class="files">
						{#each files as file (file.documentId)}
							<li>
								<span>
									{copy.titles.format[file.format]}{copy.titles
										.separator}{#if file.state === 'stored'}
										<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- an API route that redirects to the stored file -->
										<a href={fileHref(file.documentId)} target="_blank" rel="noopener"
											>{file.originalName}</a
										>
									{:else}{file.originalName}{/if}
								</span>
								<span class="source">{copy.filing.added(addedAt(file.createdAt))}</span>
								{#if file.duplicates.length > 0}
									<span class="source">{copy.titles.addedTimes(file.duplicates.length + 1)}</span>
								{/if}
							</li>
						{/each}
					</ul>
					<p class="source">{copy.filing.opensInNewTab}</p>
				</dd>
			</div>
		</dl>

		{#each questions as file (file.documentId)}
			{@const current = answers[file.documentId]}
			{#if current}
				<Notice role="note" title={copy.needsKind.title}>
					<p>{copy.needsKind.detail}</p>
					<KindForm
						initial={current.classification}
						kinds={kindChoices(file.format)}
						submitLabel={kindSaveLabel}
						primary={primaryAvailable}
						{busy}
						onsubmit={kindFrom(file.documentId, 'question')}
					/>
				</Notice>
			{/if}
		{/each}

		{#if message}
			<Notice title={message} />
		{/if}

		{#if readable.length > 0}
			<section class="read-as" aria-labelledby="{id}-read-as">
				<h3 id="{id}-read-as">{copy.filing.readAs}</h3>
				{#each readable as file (file.documentId)}
					{@render readAsFile(file)}
				{/each}
			</section>
		{/if}

		{#if seeFigures || canReadAgain}
			<!-- Both secondary: a link to the figures and an outline button to read the filing again. -->
			<div class="actions">
				{#if seeFigures && view.companyId}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the id is known only at runtime; the path is resolve()d -->
					<a href={companyHref(view.companyId)}>{copy.filing.seeFigures}</a>
				{/if}
				{#if canReadAgain}
					{@render retryButton('again', 'again', onreadagain)}
				{/if}
			</div>
		{/if}
	</div>
</article>

<style>
	.filing {
		border: var(--rule) solid var(--ink);
		min-width: 0;
	}

	.head {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-4);
		border-bottom: var(--rule) solid var(--ink);
	}

	h2 {
		min-width: 0;
		font-stretch: var(--wdth-heading);
		font-weight: 700;
		font-size: var(--text-lg);
		line-height: var(--leading-heading);
		letter-spacing: var(--tracking-heading);
		overflow-wrap: anywhere;
	}

	.meta-line {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		padding: var(--space-4) var(--space-4) var(--space-5);
	}

	h3 {
		font-size: 1rem;
		font-weight: 700;
		line-height: 1.2;
		margin-bottom: var(--space-2);
	}

	h4 {
		font-size: 1rem;
		font-weight: 700;
		line-height: 1.2;
		margin-bottom: var(--space-2);
		overflow-wrap: anywhere;
	}

	.box {
		border-top: var(--rule) solid var(--ink);
		border-bottom: var(--rule) solid var(--ink);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3) var(--space-5);
		margin-top: var(--space-2);
	}

	.body > .actions {
		margin-top: 0;
	}

	.busy-note {
		flex-basis: 100%;
		font-size: 1rem;
		line-height: var(--leading-small);
		color: var(--ink-muted);
	}

	/* The ledger: divs with roles, rows stacked until its container is 36rem wide. */
	.sources {
		container-type: inline-size;
	}

	.ledger {
		border-top: var(--rule) solid var(--ink);
		border-bottom: var(--rule) solid var(--ink);
	}

	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-2) var(--space-5);
		font-size: 1rem;
		line-height: var(--leading-small);
	}

	.row:not(.head-row) {
		padding: var(--space-3) 0;
	}

	.row + .row {
		border-top: var(--rule-thin) solid var(--ink-muted);
	}

	.statement {
		font-weight: 700;
	}

	.cell {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.note {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
	}

	.strong {
		font-weight: 700;
	}

	.col-name {
		font-size: var(--text-sm);
	}

	@container (min-width: 36rem) {
		.row {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 1.4fr);
		}

		.col-name {
			display: none;
		}

		/* The header row shows again once the cells no longer carry their own headers. */
		.head-row.visually-hidden {
			position: static;
			width: auto;
			height: auto;
			margin: 0;
			padding: var(--space-2) 0;
			overflow: visible;
			clip-path: none;
			white-space: normal;
			border-bottom: var(--rule) solid var(--ink);
			font-size: var(--text-sm);
			font-weight: 700;
		}

		.head-row + .row {
			border-top: 0;
		}
	}

	.files {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.files li {
		display: flex;
		flex-direction: column;
		gap: 2px;
		overflow-wrap: anywhere;
	}

	.read-as {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.read-as h3 {
		margin-bottom: 0;
	}

	.not-yet {
		font-size: 1rem;
		margin-bottom: var(--space-3);
	}

	.spec {
		margin: 0;
		border-top: var(--rule) solid var(--ink);
		border-bottom: var(--rule) solid var(--ink);
		container-type: inline-size;
	}

	.entry {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-1) var(--space-5);
		padding: var(--space-3) 0;
	}

	.entry + .entry {
		border-top: var(--rule-thin) solid var(--ink-muted);
	}

	dt {
		font-weight: 700;
		font-size: 1rem;
	}

	dd {
		margin: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		min-width: 0;
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0 var(--space-3);
	}

	.meta:empty {
		display: none;
	}

	.value {
		font-size: 1rem;
		overflow-wrap: anywhere;
	}

	.source {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
		color: var(--ink-muted);
		overflow-wrap: anywhere;
	}

	/* An action on this page that reads as a link: underlined, inverting on hover. */
	.text-button {
		min-height: var(--target);
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		font-size: var(--text-sm);
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

	/* Keeps its 44px target without spacing out the line it sits on. */
	.meta .text-button {
		margin-block: calc((var(--target) - 1.5rem) / -2);
	}

	.edit {
		width: 100%;
		margin-top: var(--space-2);
		padding: var(--space-4) 0 var(--space-2);
		border-top: var(--rule-thin) solid var(--ink-muted);
	}

	@container (min-width: 30rem) {
		.entry {
			grid-template-columns: 8.75rem minmax(0, 1fr);
		}
	}

	@media (min-width: 768px) {
		.head {
			padding: var(--space-4) var(--space-5);
		}

		.body {
			padding: var(--space-5) var(--space-5) var(--space-6);
		}
	}
</style>
