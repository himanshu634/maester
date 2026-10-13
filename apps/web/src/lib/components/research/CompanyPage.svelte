<!--
	A company's page under Research: the stock and the business on top, then its statements year by
	year from every read annual report, and the selected figure's evidence beside them. The company
	comes from "?id=": the route is prerendered once, and this component only renders in the browser
	(SignedInPage draws its children after the session check), so reading the query is safe here.
-->
<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { researchContent as copy } from '$lib/content/research';
	import { ApiError, readMe, type Fetcher } from '$lib/documents/client';
	import type { ReportingBasis, StatementKind } from '$lib/documents/types';
	import { researchApi, type ResearchApi } from '$lib/research/client';
	import type { Pos } from '$lib/research/grid';
	import { summarize } from '$lib/research/summary';
	import type {
		CompanyFinancials,
		CompanyStock,
		StatementTable as Table
	} from '$lib/research/types';
	import { filingLong, fyLabel, unitWords } from '$lib/research/view';
	import SectionIssue from '$lib/components/errors/SectionIssue.svelte';
	import Hatch from '$lib/components/loading/Hatch.svelte';
	import StockSummary from './StockSummary.svelte';
	import StatementTable from './StatementTable.svelte';
	import FigurePanel from './FigurePanel.svelte';

	const id = $props.id();
	const fetcher: Fetcher = (url, init) => fetch(url, init);
	const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	const KINDS: StatementKind[] = ['income_statement', 'balance_sheet', 'cash_flow'];
	const BASES: ReportingBasis[] = ['consolidated', 'standalone', 'unknown'];

	let companyId = $derived(page.url.searchParams.get('id'));
	let load = $state<'loading' | 'not-found' | 'failed' | 'ready'>('loading');
	let api = $state.raw<ResearchApi | null>(null);
	let financials = $state.raw<CompanyFinancials | null>(null);
	let stock = $state.raw<CompanyStock | null>(null);
	let stockFailed = $state(false);
	let stockRetrying = $state(false);
	let stockOutcome = $state('');
	let statement = $state<StatementKind>('income_statement');
	let basis = $state<ReportingBasis>('consolidated');
	let selected = $state<Pos | null>(null);

	/** Only the latest load may decide, so a slow answer for another company cannot overwrite it. */
	let latest = 0;

	async function start(target: string | null) {
		const mine = ++latest;
		load = 'loading';
		financials = null;
		stock = null;
		stockFailed = false;
		stockOutcome = '';
		selected = null;
		if (!target || !UUID.test(target)) {
			load = 'not-found';
			return;
		}
		try {
			const me = await readMe(fetcher);
			if (mine !== latest) return;
			const ws = me.workspaces[0];
			if (!ws) {
				load = 'not-found';
				return;
			}
			const client = researchApi(fetcher, ws.id);
			const [f, s] = await Promise.allSettled([client.financials(target), client.stock(target)]);
			if (mine !== latest) return;
			api = client;
			if (f.status === 'rejected') {
				load = f.reason instanceof ApiError && f.reason.status === 404 ? 'not-found' : 'failed';
				return;
			}
			financials = f.value;
			stock = s.status === 'fulfilled' ? s.value : null;
			stockFailed = s.status === 'rejected';
			const read = f.value.tables
				.filter((t) => t.statement === 'income_statement')
				.map((t) => t.basis);
			statement = 'income_statement';
			basis = read.includes('consolidated') ? 'consolidated' : (read[0] ?? 'consolidated');
			load = 'ready';
		} catch {
			if (mine === latest) load = 'failed';
		}
	}

	async function retryStock() {
		const mine = latest;
		const target = companyId;
		if (!api || !target || stockRetrying) return;
		stockRetrying = true;
		stockOutcome = '';
		try {
			const next = await api.stock(target);
			if (mine !== latest) return;
			stock = next;
			stockFailed = false;
		} catch {
			if (mine !== latest) return;
			stockFailed = true;
			await tick();
			stockOutcome = copy.company.stockFailed.again;
		} finally {
			stockRetrying = false;
		}
	}

	$effect(() => {
		const target = companyId;
		untrack(() => start(target));
	});

	let name = $derived(financials?.company.displayName ?? '');
	let summary = $derived(summarize({ financials, stock, stockFailed }));
	let table = $derived<Table | null>(
		financials?.tables.find((t) => t.statement === statement && t.basis === basis) ?? null
	);
	let bases = $derived(BASES.filter((b) => financials?.tables.some((t) => t.basis === b)));
	let counted = $derived(financials?.filings.filter((f) => f.counted) ?? []);
	/** The years read, newest first; a filing with no period is counted but not named. */
	let years = $derived(
		counted
			.map((f) => f.periodEnd)
			.filter((d): d is string => d !== null && d !== '')
			.sort()
			.reverse()
			.map(fyLabel)
	);
	let results = $derived(financials?.filings.filter((f) => f.kind === 'financial_results') ?? []);
	let identity = $derived.by(() => {
		const c = financials?.company;
		if (!c) return '';
		const words = copy.company.identity;
		return [
			c.nseSymbol ? `${words.nse} ${c.nseSymbol}` : null,
			c.bseCode ? `${words.bse} ${c.bseCode}` : null,
			c.cin ? `${words.cin} ${c.cin}` : null
		]
			.filter(Boolean)
			.join(' · ');
	});
	let usedInPe = $derived(
		!!(
			selected &&
			summary.epsCell &&
			table &&
			financials?.tables.indexOf(table) === summary.epsCell.tableIndex &&
			selected.r === summary.epsCell.row &&
			selected.c === summary.epsCell.col
		)
	);
	let kindLabel = $derived(copy.statements.kinds[statement]);
	let basisLabel = $derived(copy.statements.bases[basis]);
	let leftOut = $derived(
		(table?.leftOut ?? []).map((item) => {
			const filing = financials?.filings.find((f) => f.documentId === item.documentId);
			return copy.statements.leftOut[item.reason](filingLong(filing?.periodEnd ?? null));
		})
	);

	async function select(pos: Pos) {
		selected = pos;
		// Below 1024px the panel is under the table: take the reader there.
		if (!matchMedia('(min-width: 1024px)').matches) {
			await tick();
			document.getElementById(`${id}-panel`)?.focus();
		}
	}

	function back() {
		if (selected) document.getElementById(`${id}-table-${selected.r}-${selected.c}`)?.focus();
	}

	function choose(next: { statement?: StatementKind; basis?: ReportingBasis }) {
		statement = next.statement ?? statement;
		basis = next.basis ?? basis;
		selected = null;
	}
</script>

{#snippet backLink()}
	<a class="back" href={resolve('/terminal/research')}
		><span aria-hidden="true">←</span> {copy.company.back}</a
	>
{/snippet}

<div class="company">
	{#if load === 'loading'}
		<div class="intro">
			{@render backLink()}
			<div class="skeleton" aria-busy="true" aria-describedby="{id}-waiting">
				<h1>
					<span class="visually-hidden">{copy.company.heading}</span>
					<Hatch width="60%" height="2.5rem" />
				</h1>
				<Hatch width="40%" height="1.25rem" />
				<Hatch height="8rem" />
				<Hatch height="24rem" />
			</div>
		</div>
		<p class="waiting" id="{id}-waiting" role="status">{copy.company.loading(null)}</p>
	{:else if load === 'not-found'}
		<div class="intro">
			<h1>{copy.company.notFound.title}</h1>
			<p><a href={resolve('/terminal/research')}>{copy.company.notFound.back}</a></p>
		</div>
	{:else if load === 'failed'}
		<div class="intro">
			{@render backLink()}
			<h1 class="visually-hidden">{copy.company.heading}</h1>
		</div>
		<SectionIssue
			title={copy.company.financialsFailed.title}
			detail={copy.company.financialsFailed.detail}
			retryLabel={copy.company.financialsFailed.retry}
			onretry={() => start(companyId)}
		/>
	{:else if financials}
		<div class="intro">
			{@render backLink()}
			<h1>{name}</h1>
			{#if identity}<p class="identity num">{identity}</p>{/if}
			{#if years.length}
				<p class="read-from">
					<span class="muted">{copy.company.readFrom(counted.length)}</span>
					{years.join(', ')}.
				</p>
			{/if}
		</div>

		<StockSummary
			{summary}
			{stock}
			{name}
			failed={stockFailed}
			onretry={retryStock}
			retrying={stockRetrying}
			outcome={stockOutcome}
		/>

		<section class="statements" aria-labelledby="{id}-statements">
			<h2 id="{id}-statements">{copy.statements.heading}</h2>
			{#if counted.length === 0}
				<p>{copy.company.nothingRead(name)}</p>
				<p><a href={resolve('/terminal/documents')}>{copy.company.addInDocuments}</a></p>
			{:else}
				<div class="controls">
					<div class="toggles" role="group" aria-label={copy.statements.statementGroup}>
						{#each KINDS as kind (kind)}
							<button
								type="button"
								class="button outline"
								aria-pressed={statement === kind}
								onclick={() => choose({ statement: kind })}>{copy.statements.kinds[kind]}</button
							>
						{/each}
					</div>
					{#if bases.length}
						<div class="toggles" role="group" aria-label={copy.statements.basisGroup}>
							{#each bases as b (b)}
								<button
									type="button"
									class="button outline"
									aria-pressed={basis === b}
									onclick={() => choose({ basis: b })}>{copy.statements.bases[b]}</button
								>
							{/each}
						</div>
					{/if}
				</div>

				{#if table && api}
					<div class="figures-layout">
						<div class="table-col">
							<div class="caption-line">
								<p>{copy.statements.caption(basisLabel, kindLabel)}</p>
								<p class="muted">{copy.statements.unit(unitWords(table.unit))}</p>
							</div>
							{#key table}
								<StatementTable
									{table}
									{selected}
									onselect={select}
									label={copy.statements.region(kindLabel)}
									idPrefix="{id}-table"
								/>
							{/key}
							<div class="notes muted">
								<p>{copy.statements.newestWins}</p>
								{#if table.unplaced > 0}<p>{copy.statements.unplaced(table.unplaced)}</p>{/if}
								{#each leftOut as note, index (index)}<p>{note}</p>{/each}
							</div>
						</div>
						<div class="panel-col">
							<FigurePanel
								{table}
								pos={selected}
								pageHref={api.pageHref}
								{usedInPe}
								headingId="{id}-panel"
								onback={back}
							/>
						</div>
					</div>
				{:else}
					<p>{copy.statements.notRead(basisLabel, kindLabel)}</p>
				{/if}
				{#if results.length}
					<p class="notes muted">
						{copy.company.notInTable(results.map((f) => f.originalName).join(', '))}
					</p>
				{/if}
			{/if}
		</section>
	{/if}
</div>

<style>
	.company {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		min-width: 0;
	}

	.intro {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
	}

	.back {
		font-size: 1rem;
	}

	h1 {
		font-stretch: var(--wdth-wide);
		font-weight: 800;
		font-size: 2rem;
		line-height: var(--leading-heading);
		letter-spacing: var(--tracking-heading);
	}

	.identity,
	.read-from {
		font-size: 1rem;
		line-height: var(--leading-small);
	}

	.skeleton {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		align-self: stretch;
	}

	.waiting {
		font-size: 1rem;
	}

	.statements {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		min-width: 0;
	}

	h2 {
		font-stretch: var(--wdth-heading);
		font-weight: 700;
		font-size: var(--text-lg);
		line-height: var(--leading-heading);
		letter-spacing: var(--tracking-heading);
	}

	.controls {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.toggles {
		display: flex;
	}

	.toggles .button {
		flex: 1 1 0;
		padding: 0 var(--space-4);
		text-align: center;
	}

	.toggles .button + .button {
		margin-left: calc(-1 * var(--rule));
	}

	.toggles .button[aria-pressed='true'] {
		background: var(--ink);
		color: var(--paper);
	}

	.figures-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-6);
		align-items: start;
	}

	.table-col {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}

	.caption-line {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: var(--space-1) var(--space-4);
		font-size: var(--text-sm);
		line-height: var(--leading-small);
	}

	.caption-line p:first-child {
		font-size: 1rem;
	}

	.notes {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--text-sm);
		line-height: var(--leading-small);
		max-width: var(--measure);
	}

	.panel-col {
		min-width: 0;
	}

	@media (min-width: 768px) {
		h1 {
			font-size: var(--text-2xl);
		}

		.controls {
			flex-direction: row;
			flex-wrap: wrap;
			justify-content: space-between;
		}

		.toggles .button {
			flex: 0 0 auto;
		}
	}

	@media (min-width: 1024px) {
		.company {
			gap: var(--space-8);
		}

		/* The panel is a column beside the table, and stays in view while the table scrolls by. */
		.figures-layout {
			grid-template-columns: minmax(0, 1fr) clamp(18rem, 31%, 22.5rem);
		}

		.panel-col {
			position: sticky;
			top: var(--space-6);
		}
	}
</style>
