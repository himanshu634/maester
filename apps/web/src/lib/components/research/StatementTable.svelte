<!--
	One statement, year by year: a real table in a labelled region that scrolls sideways, the line
	names as sticky row headers, and each figure a button that selects it for the figure panel.
	One tab stop: the arrow keys move between figures, Home and End jump to the ends of a row. An
	unknown or missing figure is "—" with its reason read out. A row that an older filing printed
	differently for a year says that year was restated.
-->
<script lang="ts">
	import { researchContent } from '$lib/content/research';
	import { move, type Pos } from '$lib/research/grid';
	import type { FinancialRow, StatementTable } from '$lib/research/types';
	import { cellReason, cellText, filingShort, fyLabel } from '$lib/research/view';

	interface Props {
		table: StatementTable;
		selected: Pos | null;
		onselect: (pos: Pos) => void;
		/** Names the scrolling region and the table. */
		label: string;
		/** Figure buttons are `${idPrefix}-${row}-${column}`, so the page can return focus to one. */
		idPrefix: string;
	}

	let { table, selected, onselect, label, idPrefix }: Props = $props();

	const copy = researchContent.statements;

	/** The figure that holds the tab stop: the selected one, else the newest year's first line. */
	let active = $derived<Pos>(selected ?? { r: 0, c: table.columns.length - 1 });
	/** The line names' width, so a figure moved to by the keyboard never hides under them. */
	let lineWidth = $state(0);

	/** Rows in runs of one section, each run its own row group. */
	let groups = $derived.by(() => {
		const out: { key: string; section: string; rows: { row: FinancialRow; r: number }[] }[] = [];
		table.rows.forEach((row, r) => {
			const last = out.at(-1);
			if (last && last.section === row.section) last.rows.push({ row, r });
			else out.push({ key: row.key, section: row.section, rows: [{ row, r }] });
		});
		return out;
	});

	function key(event: KeyboardEvent, r: number, c: number) {
		const next = move({ r, c }, event.key, table.rows.length, table.columns.length);
		if (!next) return;
		event.preventDefault();
		if (next.r === r && next.c === c) return;
		active = next;
		document.getElementById(`${idPrefix}-${next.r}-${next.c}`)?.focus();
	}

	/** Start at the newest years: on a narrow screen the oldest are a swipe away. */
	function toNewest(node: HTMLElement) {
		node.scrollLeft = node.scrollWidth;
	}
</script>

<!-- A region that scrolls must take focus so keyboard users can scroll it (WCAG 2.1.1). -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	class="scroll-x region"
	role="region"
	aria-label={label}
	tabindex="0"
	style:scroll-padding-left="{lineWidth}px"
	{@attach toNewest}
>
	<table>
		<caption class="visually-hidden">{label}</caption>
		<thead>
			<tr>
				<th scope="col" class="line muted" bind:clientWidth={lineWidth}>{copy.line}</th>
				{#each table.columns as col (col.periodEnd)}
					<th scope="col" class="figure">
						<span class="year">{fyLabel(col.periodEnd)}</span>
						<span class="muted from">{filingShort(col.filingPeriodEnd)}</span>
					</th>
				{/each}
			</tr>
		</thead>
		{#each groups as group (group.key)}
			<tbody>
				{#if group.section}
					<tr class="section">
						<th scope="rowgroup" class="line">{group.section}</th>
						<td colspan={table.columns.length}></td>
					</tr>
				{/if}
				{#each group.rows as { row, r } (row.key)}
					<tr class={{ subtotal: row.isSubtotal }}>
						<th scope="row" class="line">
							<span class="label"
								>{row.label}{#if row.perShare}<span class="muted unit"
										>{` (${copy.perShareUnit})`}</span
									>{/if}</span
							>
							{#each table.columns as col, c (col.periodEnd)}
								{#if row.cells[c]?.restated}
									<span class="muted note">{copy.restated(fyLabel(col.periodEnd))}</span>
								{/if}
							{/each}
						</th>
						{#each table.columns as col, c (col.periodEnd)}
							{@const cell = row.cells[c]}
							<td class="figure num">
								{#if cell}
									{@const reason = cellReason(cell, filingShort(col.filingPeriodEnd))}
									<button
										type="button"
										id="{idPrefix}-{r}-{c}"
										class={['cell', { muted: cell.status !== 'value' }]}
										aria-pressed={selected?.r === r && selected?.c === c}
										tabindex={active.r === r && active.c === c ? 0 : -1}
										onclick={() => onselect({ r, c })}
										onkeydown={(event) => key(event, r, c)}
										>{#if reason}<span aria-hidden="true">{cellText(cell)}</span><span
												class="visually-hidden">{reason}</span
											>{:else}{cellText(cell)}{/if}</button
									>
								{/if}
							</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		{/each}
	</table>
</div>

<style>
	/*
	 * Room for a figure's focus ring (3px at a 2px offset) past the table's right and bottom
	 * edges, without moving the table. The left edge is the line names and the top the header,
	 * neither of which takes focus.
	 */
	.region {
		container-type: inline-size;
		margin: 0 -5px -5px 0;
		padding: 0 5px 5px 0;
	}

	/* The box's left side is drawn by the line names, so it stays when the years scroll. */
	table {
		width: 100%;
		border-collapse: separate;
		border-spacing: 0;
		border: var(--rule) solid var(--ink);
		border-left: 0;
		font-size: 0.9375rem;
		line-height: var(--leading-small);
	}

	th,
	td {
		padding: 10px var(--space-3);
		text-align: left;
		vertical-align: middle;
	}

	th {
		font-weight: 400;
	}

	thead th {
		vertical-align: bottom;
		border-bottom: var(--rule) solid var(--ink);
	}

	thead .line {
		font-size: var(--text-sm);
	}

	.year,
	.from {
		display: block;
		white-space: nowrap;
	}

	.year {
		font-weight: 700;
	}

	.from {
		font-size: var(--text-sm);
	}

	/* Hairlines between body rows; the header's 2px rule sits above the first. */
	tbody > tr > * {
		border-top: var(--rule-thin) solid var(--ink-muted);
	}

	tbody:first-of-type > tr:first-child > * {
		border-top: 0;
	}

	/*
	 * The line names stay put while the years scroll under them. Their 2px rules on both sides
	 * are drawn rather than bordered, so a row's hairline never leaves a corner on them.
	 */
	.line {
		position: sticky;
		left: 0;
		z-index: 1;
		background: var(--paper);
		padding-left: calc(var(--space-3) + var(--rule));
		padding-right: calc(var(--space-3) + var(--rule));
	}

	.line::before,
	.line::after {
		content: '';
		position: absolute;
		top: calc(-1 * var(--rule-thin));
		bottom: 0;
		width: var(--rule);
		background: var(--ink);
	}

	.line::before {
		left: 0;
	}

	.line::after {
		right: 0;
	}

	.label,
	.note {
		display: block;
	}

	.note {
		font-size: var(--text-sm);
		line-height: 1.35;
	}

	.section th {
		padding-top: var(--space-3);
		padding-bottom: 6px;
		font-size: var(--text-sm);
		font-weight: 700;
		color: var(--ink-muted);
	}

	.subtotal th,
	.subtotal .cell {
		font-weight: 700;
	}

	.figure {
		text-align: right;
		white-space: nowrap;
	}

	td.figure {
		padding: 0;
	}

	.cell {
		display: block;
		width: 100%;
		min-height: var(--target);
		padding: 10px var(--space-3);
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: right;
		cursor: pointer;
	}

	.cell.muted {
		color: var(--ink-muted);
	}

	.cell:hover {
		outline: var(--rule) solid var(--ink);
		outline-offset: calc(-1 * var(--rule));
	}

	.cell[aria-pressed='true'] {
		background: var(--ink);
		color: var(--paper);
	}

	.cell:focus-visible {
		position: relative;
		z-index: 2;
		outline: var(--focus-ring);
		outline-offset: var(--focus-offset);
	}

	/*
	 * The line names keep to one line while there is room for them and the years. In a narrow
	 * column (a phone, or beside the figure panel at 1024px) they wrap, so more years show.
	 */
	tbody .line {
		white-space: nowrap;
	}

	@container (max-width: 40rem) {
		tbody .line {
			white-space: normal;
			width: 12rem;
			min-width: 12rem;
		}
	}

	@container (max-width: 30rem) {
		th,
		td {
			padding: var(--space-2) 10px;
		}

		.line {
			padding-left: calc(10px + var(--rule));
			padding-right: calc(10px + var(--rule));
		}

		.cell {
			padding: var(--space-2) 10px;
		}

		tbody .line {
			width: 9rem;
			min-width: 9rem;
		}
	}
</style>
