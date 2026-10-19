<!--
	One table of what is held across the accounts (A1): company, where it is held, quantity,
	Maester's NSE close, value and weight, closed by a 2px totals row. Figures right-aligned and
	tabular. A part read before its broker signed Maester out is starred and footnoted. A close
	Maester does not have is "—" with the reason read out, and the row has no value or weight.
	Wide, it scrolls inside its labelled region, which takes focus.
-->
<script lang="ts">
	import { holdingsContent as copy } from '$lib/content/holdings';
	import { percentText, rupees, shares } from '$lib/holdings/format';
	import type { HoldingsSnapshot } from '$lib/holdings/types';
	import { heldAtWords, staleNote } from '$lib/holdings/view';

	interface Props {
		snapshot: HoldingsSnapshot;
	}

	let { snapshot }: Props = $props();

	const id = $props.id();
	const names = $derived(Object.fromEntries(snapshot.accounts.map((a) => [a.broker, a.name])));
	const footnote = $derived(staleNote(snapshot));
	const cols = copy.table.columns;
</script>

{#snippet unknown(reason: string)}
	<span aria-hidden="true">—</span><span class="visually-hidden">{reason}</span>
{/snippet}

{#if snapshot.rows.length === 0}
	<p>{copy.table.empty}</p>
{:else}
	<!-- A region that scrolls must take focus so keyboard users can scroll it (WCAG 2.1.1). -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div class="scroll-x" role="region" aria-labelledby="{id}-caption" tabindex="0">
		<table>
			<caption id="{id}-caption" class="visually-hidden">{copy.table.label}</caption>
			<thead>
				<tr>
					<th scope="col">{cols.company}</th>
					<th scope="col">{cols.heldAt}</th>
					<th scope="col" class="r">{cols.quantity}</th>
					<th scope="col" class="r">{cols.close}</th>
					<th scope="col" class="r">{cols.value}</th>
					<th scope="col" class="r">{cols.weight}</th>
				</tr>
			</thead>
			<tbody>
				{#each snapshot.rows as row (row.isin)}
					<tr>
						<th scope="row">
							<span class="strong">{row.symbol}</span>
							<span class="muted small">{row.exchange} · {row.isin}</span>
						</th>
						<td>{heldAtWords(row, names)}</td>
						<td class="r num">{shares(row.quantity)}</td>
						<td class="r num"
							>{#if row.close}{rupees(row.close.value)}{:else}{@render unknown(
									copy.table.noClose
								)}{/if}</td
						>
						<td class="r num"
							>{#if row.value}{rupees(row.value)}{:else}{@render unknown(
									copy.table.noClose
								)}{/if}</td
						>
						<td class="r num"
							>{#if row.weight}{percentText(row.weight)}{:else}{@render unknown(
									copy.table.noClose
								)}{/if}</td
						>
					</tr>
				{/each}
			</tbody>
			<tfoot>
				<tr>
					<th scope="row">{copy.table.total}</th>
					<td></td>
					<td></td>
					<td></td>
					<td class="r num"
						>{#if snapshot.totals.knownValue}{rupees(
								snapshot.totals.knownValue
							)}{:else}{@render unknown(copy.strip.unknown)}{/if}</td
					>
					<td></td>
				</tr>
			</tfoot>
		</table>
	</div>
	{#if snapshot.rows.some((r) => r.unknown.includes('NO_CLOSE'))}
		<p class="muted small">{copy.table.noClose}</p>
	{/if}
	{#if footnote}<p class="muted small">{footnote}</p>{/if}
{/if}

<style>
	table {
		width: 100%;
		min-width: 46rem;
		border-collapse: collapse;
		border: var(--rule) solid var(--ink);
	}

	th,
	td {
		padding: var(--space-3) var(--space-4);
		text-align: left;
		vertical-align: baseline;
		font-size: 1rem;
		line-height: var(--leading-small);
		font-weight: 400;
	}

	thead th {
		font-size: var(--text-sm);
		color: var(--ink-muted);
		border-bottom: var(--rule) solid var(--ink);
	}

	tbody tr + tr {
		border-top: var(--rule-thin) solid var(--ink-muted);
	}

	tbody th {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	tfoot tr {
		border-top: var(--rule) solid var(--ink);
	}

	tfoot th,
	tfoot td {
		font-weight: 700;
	}

	.r {
		text-align: right;
	}

	.strong {
		font-weight: 700;
	}

	.small {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
	}

	p.small {
		margin-top: var(--space-2);
		max-width: var(--measure);
	}
</style>
