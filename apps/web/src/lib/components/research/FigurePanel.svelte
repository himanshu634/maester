<!--
	The selected figure's evidence: the line and year, the figure, then where it came from, whether
	the page's text contains it, whether its sum adds up, what uses it and whether it was reviewed,
	and a link that opens the filing at its page. Beside the table from 1024px; under it below
	that, where "Back to the table" returns focus to the figure.
-->
<script lang="ts">
	import { researchContent } from '$lib/content/research';
	import type { Pos } from '$lib/research/grid';
	import type { StatementTable } from '$lib/research/types';
	import {
		addsUp,
		cellReason,
		cellText,
		filingLong,
		filingShort,
		onPage,
		unitWords,
		type Words
	} from '$lib/research/view';

	interface Props {
		table: StatementTable;
		pos: Pos | null;
		pageHref: (documentId: string, pageIndex: number) => string;
		/** The figure is the earnings per share the summary's price to earnings divides by. */
		usedInPe: boolean;
		headingId: string;
		onback: () => void;
	}

	let { table, pos, pageHref, usedInPe, headingId, onback }: Props = $props();

	const copy = researchContent.panel;
	const statements = researchContent.statements;

	let picked = $derived.by(() => {
		if (!pos) return null;
		const row = table.rows[pos.r];
		const col = table.columns[pos.c];
		const cell = row?.cells[pos.c];
		return row && col && cell ? { row, col, cell } : null;
	});
</script>

{#snippet words(said: Words)}
	{#if said.strong}<strong>{said.strong}</strong>{/if}
	{said.text}
{/snippet}

<aside class="panel" aria-labelledby={headingId}>
	<p class="muted eyebrow">{copy.eyebrow}</p>
	{#if !picked}
		<h3 id={headingId} tabindex="-1">{copy.none}</h3>
	{:else}
		{@const { row, col, cell } = picked}
		{@const source = cell.source}
		{@const reason = cellReason(cell, filingShort(col.filingPeriodEnd))}
		<div class="head">
			<h3 id={headingId} tabindex="-1">{row.label}</h3>
			<p class="muted context">
				{copy.context(
					statements.kinds[table.statement],
					statements.bases[table.basis],
					col.periodLabel
				)}
			</p>
		</div>
		<p class="value">
			<span class={['figure', 'num', { muted: cell.status !== 'value' }]}>{cellText(cell)}</span>
			<span class="muted unit"
				>{row.perShare ? statements.perShareUnit : unitWords(table.unit)}</span
			>
		</p>
		<dl class="spec">
			<div class="entry">
				<dt>{copy.terms.from}</dt>
				<dd>
					{#if source}
						{copy.from(
							filingLong(col.filingPeriodEnd),
							researchContent.words.page(source.pageIndex + 1, source.pageCount).toLowerCase()
						)}
					{:else}
						{reason ?? '—'}
					{/if}
				</dd>
			</div>
			{#if cell.restated}
				<div class="entry">
					<dt>{copy.terms.restated}</dt>
					<dd>
						{copy.restated(
							filingLong(cell.restated.filingPeriodEnd),
							cell.restated.printed,
							cell.restated.pageIndex + 1
						)}
					</dd>
				</div>
			{/if}
			{#if source}
				<div class="entry">
					<dt>{copy.terms.onPage}</dt>
					<dd>
						{#if reason}{reason}{:else}{@render words(onPage(cell))}{/if}
					</dd>
				</div>
				<div class="entry">
					<dt>{copy.terms.addsUp}</dt>
					<dd>{@render words(addsUp(cell))}</dd>
				</div>
			{/if}
			{#if usedInPe}
				<div class="entry">
					<dt>{copy.terms.usedIn}</dt>
					<dd>{copy.usedIn}</dd>
				</div>
			{/if}
			<div class="entry">
				<dt>{copy.terms.reviewed}</dt>
				<dd>{copy.reviewed}</dd>
			</div>
		</dl>
		{#if source}
			{@const pdf = pageHref(source.documentId, source.pageIndex)}
			<div class="open">
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- an API route that redirects to the stored PDF -->
				<a class="button outline" href={pdf} target="_blank" rel="noopener"
					>{copy.open(source.pageIndex + 1)}</a
				>
				<p class="muted note">{copy.openNote(source.pageIndex + 1)}</p>
			</div>
		{/if}
		<button type="button" class="button outline back" onclick={onback}>{copy.back}</button>
	{/if}
</aside>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		min-width: 0;
		padding-top: var(--space-5);
		border-top: var(--rule) solid var(--ink);
	}

	.eyebrow,
	.context,
	.unit,
	.note {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
	}

	.eyebrow {
		margin-bottom: calc(-1 * var(--space-3));
	}

	.head {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	h3 {
		font-stretch: var(--wdth-heading);
		font-weight: 700;
		font-size: var(--text-lg);
		line-height: 1.2;
	}

	.value {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-1) 10px;
	}

	.figure {
		font-stretch: var(--wdth-heading);
		font-weight: 700;
		font-size: var(--text-2xl);
		line-height: 1.05;
		letter-spacing: var(--tracking-heading);
	}

	.spec {
		margin: 0;
		border-top: var(--rule) solid var(--ink);
		border-bottom: var(--rule) solid var(--ink);
	}

	.entry {
		display: grid;
		grid-template-columns: 7.5rem minmax(0, 1fr);
		gap: var(--space-4);
		padding: var(--space-3) 0;
		font-size: 1rem;
		line-height: var(--leading-small);
	}

	.entry + .entry {
		border-top: var(--rule-thin) solid var(--ink-muted);
	}

	dt {
		font-weight: 700;
	}

	dd {
		margin: 0;
		min-width: 0;
	}

	.open {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
	}

	.back {
		align-self: flex-start;
	}

	@media (min-width: 1024px) {
		.panel {
			padding-top: 0;
			padding-left: var(--space-6);
			border-top: 0;
			border-left: var(--rule) solid var(--ink);
		}

		.back {
			display: none;
		}
	}
</style>
