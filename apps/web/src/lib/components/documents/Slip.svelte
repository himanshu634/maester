<!--
	The slip: one document, where it stands and what Maester read it as. A 2px box with the
	filename and when it was added, the stage ladder, then whatever needs the investor (confirm the
	company, say what it is, try again), then "Read as": each answer with the page and words it
	came from, or "You said so". What it is and the company can be changed in place; a change is
	read again. Never a confidence.
-->
<script module lang="ts">
	import type { ChangeClassificationRequest } from '$lib/documents/types';

	export type Change = Omit<ChangeClassificationRequest, 'basedOn'>;
</script>

<script lang="ts">
	import { documentsContent as copy } from '$lib/content/documents';
	import {
		addedAt,
		identifiers,
		ladder,
		periodWords,
		sourceOf,
		statementsWords,
		whatItIs
	} from '$lib/documents/intake';
	import type {
		Company,
		CompanyAnswer,
		DocumentClassification,
		DocumentRecord,
		EvidenceField
	} from '$lib/documents/types';
	import Notice from '$lib/components/auth/Notice.svelte';
	import SectionIssue from '$lib/components/errors/SectionIssue.svelte';
	import StageLadder from './StageLadder.svelte';
	import KindForm, { type KindAnswer } from './KindForm.svelte';
	import CompanyForm from './CompanyForm.svelte';

	interface Props {
		doc: DocumentRecord;
		/** The current answers, once Maester has worked out what it is. */
		answers: DocumentClassification | null;
		companies: Company[];
		/** This page is sending the file right now. */
		uploading?: boolean;
		/** What happened to the investor's last action here, when it did not work. */
		message?: string | null;
		/** Resolves true when the change was saved. */
		onchange: (change: Change) => Promise<boolean>;
		onclassify: () => Promise<void>;
		onextract: () => Promise<void>;
		onopen: (id: string) => void;
		/** The heading, so the page can move focus here when a slip is opened. */
		heading?: HTMLHeadingElement;
	}

	let {
		doc,
		answers,
		companies,
		uploading = false,
		message = null,
		onchange,
		onclassify,
		onextract,
		onopen,
		heading = $bindable()
	}: Props = $props();

	const id = $props.id();
	/** The answer being changed, and the set of answers the form was opened on. */
	let editingFor = $state<{ field: 'kind' | 'company'; answerId: string } | null>(null);
	let busy = $state(false);

	let steps = $derived(ladder(doc, { uploading }));
	let current = $derived(answers?.classification ?? null);
	let evidence = $derived(answers?.evidence ?? []);
	let jobRunning = $derived(
		!!doc.latestJob && (doc.latestJob.state === 'queued' || doc.latestJob.state === 'running')
	);
	let companyName = $derived.by(() => {
		const companyId = current?.companyId ?? doc.companyId;
		if (!companyId) return null;
		return companies.find((c) => c.id === companyId)?.displayName ?? null;
	});
	let printed = $derived(current?.companyNameAsPrinted?.trim() || null);
	/** The answer the slip is already asking for above, so it is not offered twice. */
	let asking = $derived(
		doc.intakeState === 'needs_kind'
			? 'kind'
			: doc.intakeState === 'needs_company'
				? 'company'
				: null
	);
	let values = $derived({
		kind: whatItIs(current ?? doc.classification),
		company: companyName ?? printed ?? '—',
		period: current ? periodWords(current) : '—',
		statements: current ? statementsWords(current.statementsFound) : '—'
	});

	// A form opened on one set of answers closes when different answers arrive.
	let editing = $derived(
		editingFor && editingFor.answerId === current?.id ? editingFor.field : null
	);
	let printedIds = $derived(current ? identifiers(current, evidence) : []);

	async function run<T>(work: () => Promise<T>): Promise<T | undefined> {
		if (busy) return undefined;
		busy = true;
		try {
			return await work();
		} finally {
			busy = false;
		}
	}

	async function change(next: Change) {
		const saved = await run(() => onchange(next));
		if (saved) editingFor = null;
	}

	const changeKind = (answer: KindAnswer) =>
		change({ kind: answer.kind, otherType: answer.otherType, resultsSpan: answer.resultsSpan });
	const changeCompany = (company: CompanyAnswer) => change({ company });

	function toggle(field: 'kind' | 'company') {
		editingFor = editing === field || !current ? null : { field, answerId: current.id };
	}

	function source(field: EvidenceField): string | null {
		return sourceOf(evidence, field);
	}
</script>

{#snippet sourceLine(text: string | null)}
	{#if text}
		<span class="source">{text}</span>
	{:else}
		<span class="source"
			><span aria-hidden="true">—</span><span class="visually-hidden">{copy.slip.noSource}</span
			></span
		>
	{/if}
{/snippet}

{#snippet changeButton(field: 'kind' | 'company', term: string)}
	{#if current && !uploading && !(asking === field)}
		<button
			class="text-button"
			type="button"
			aria-expanded={editing === field}
			aria-controls="{id}-{field}-form"
			aria-label={copy.slip.changeLabel(term)}
			onclick={() => toggle(field)}>{copy.slip.change}</button
		>
	{/if}
{/snippet}

<article class="slip" aria-labelledby="{id}-name">
	<header class="head">
		<h2 id="{id}-name" tabindex="-1" bind:this={heading}>{doc.originalName}</h2>
		<p class="added num muted">
			<time datetime={doc.createdAt}>{copy.slip.added(addedAt(doc.createdAt))}</time>
		</p>
	</header>

	<div class="body">
		<StageLadder {steps} label={copy.slip.stepsLabel} />

		{#if doc.state === 'pending_upload' && !uploading}
			<SectionIssue title={copy.uploadUnfinished.title} detail={copy.uploadUnfinished.detail} />
		{:else if doc.state === 'rejected'}
			{@const said = copy.rejected[doc.rejectionCode ?? 'OBJECT_MISSING']}
			<SectionIssue title={said.title} detail={said.detail} />
		{:else if doc.state !== 'stored' && doc.latestJob?.type === 'document.verify' && doc.latestJob.state === 'failed'}
			<SectionIssue title={copy.checkFailed.title} detail={copy.checkFailed.detail} />
		{:else if doc.intakeState === 'needs_company' && current}
			<Notice
				role="note"
				title={printed ? copy.company.question(printed) : copy.company.questionUnnamed}
			>
				{#if printedIds.length > 0}
					<p class="printed num">
						{#each printedIds as printedId, index (printedId.label)}
							{index > 0 ? ' · ' : ''}{copy.company.printed(
								printedId.label,
								printedId.value
							)}{printedId.page ? `, ${copy.company.onPage(printedId.page)}` : ''}
						{/each}
					</p>
				{/if}
				<p>{printed ? copy.company.newCompany : copy.company.noName}</p>
				<CompanyForm
					mode="ask"
					classification={current}
					{companies}
					{busy}
					onsubmit={changeCompany}
				/>
			</Notice>
		{:else if doc.intakeState === 'needs_kind' && current}
			<Notice role="note" title={copy.needsKind.title}>
				<p>{copy.needsKind.detail}</p>
				<KindForm
					initial={current}
					submitLabel={copy.kind.save}
					primary
					{busy}
					onsubmit={changeKind}
				/>
			</Notice>
		{:else if doc.intakeState === 'kept'}
			<Notice role="note" title={copy.kept(companyName ?? printed)} />
		{:else if doc.intakeState === 'duplicate'}
			<Notice role="note" title={copy.duplicate.title}>
				<div class="actions">
					{#if doc.duplicateOfDocumentId}
						{@const original = doc.duplicateOfDocumentId}
						<button class="text-button" type="button" onclick={() => onopen(original)}>
							{copy.duplicate.open}
						</button>
					{/if}
					<button
						class="button outline"
						type="button"
						disabled={busy}
						onclick={() => run(onclassify)}
					>
						{copy.duplicate.again}
					</button>
				</div>
			</Notice>
		{:else if doc.intakeState === 'identify_failed' && !jobRunning}
			<SectionIssue
				title={copy.identifyFailed.title}
				detail={copy.identifyFailed.detail}
				retryLabel={copy.identifyFailed.retry}
				onretry={() => run(onclassify)}
			/>
		{:else if doc.intakeState === 'read_failed' && !jobRunning}
			<SectionIssue
				title={copy.readFailed.title}
				detail={copy.readFailed.detail}
				retryLabel={copy.readFailed.retry}
				onretry={() => run(onextract)}
			/>
		{/if}

		{#if message}
			<Notice title={message} />
		{/if}

		<section class="read-as" aria-labelledby="{id}-read-as">
			<h3 id="{id}-read-as">{copy.slip.readAs}</h3>
			{#if !current}
				<p class="muted not-yet">{copy.slip.notYet}</p>
			{/if}
			<dl class="spec">
				<div class="entry">
					<dt>{copy.slip.terms.kind}</dt>
					<dd>
						<span class="value">{values.kind}</span>
						<span class="meta">
							{#if current && values.kind !== '—'}{@render sourceLine(source('kind'))}{/if}
							{@render changeButton('kind', copy.slip.terms.kind)}
						</span>
						{#if editing === 'kind' && current}
							<div class="edit" id="{id}-kind-form">
								<KindForm
									initial={current}
									submitLabel={copy.kind.saveChange}
									{busy}
									onsubmit={changeKind}
									oncancel={() => (editingFor = null)}
								/>
							</div>
						{/if}
					</dd>
				</div>
				<div class="entry">
					<dt>{copy.slip.terms.company}</dt>
					<dd>
						<span class="value">{values.company}</span>
						{#if current && !companyName && printed}
							<span class="source">{copy.slip.notConfirmed}</span>
						{/if}
						<span class="meta">
							{#if current && values.company !== '—'}{@render sourceLine(source('company'))}{/if}
							{@render changeButton('company', copy.slip.terms.company)}
						</span>
						{#if editing === 'company' && current}
							<div class="edit" id="{id}-company-form">
								<CompanyForm
									mode="change"
									classification={current}
									{companies}
									{busy}
									onsubmit={changeCompany}
									oncancel={() => (editingFor = null)}
								/>
							</div>
						{/if}
					</dd>
				</div>
				<div class="entry">
					<dt>{copy.slip.terms.period}</dt>
					<dd>
						<span class="value">{values.period}</span>
						{#if current && values.period !== '—'}{@render sourceLine(source('period'))}{/if}
					</dd>
				</div>
				<div class="entry">
					<dt>{copy.slip.terms.statements}</dt>
					<dd>
						<span class="value">{values.statements}</span>
						{#if current && values.statements !== '—'}{@render sourceLine(
								source('statements')
							)}{/if}
					</dd>
				</div>
			</dl>
		</section>
	</div>
</article>

<style>
	.slip {
		border: var(--rule) solid var(--ink);
		min-width: 0;
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-1) var(--space-4);
		padding: var(--space-4) var(--space-4);
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

	.added {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		padding: var(--space-4) var(--space-4) var(--space-5);
	}

	.printed {
		font-size: var(--text-sm);
		color: var(--ink-muted);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3) var(--space-5);
	}

	h3 {
		font-size: 1rem;
		font-weight: 700;
		line-height: 1.2;
		margin-bottom: var(--space-2);
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

	.actions .text-button {
		font-size: 1rem;
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
