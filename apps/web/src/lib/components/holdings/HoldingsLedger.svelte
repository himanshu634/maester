<!--
	Holdings by company, then by broker (D · final, canvas "Maester Broker Accounts"). Each company
	is a row group: its line (quantity, invested, close, value, P&L, P&L %, weight), then one line per
	broker that holds it, with the client ID, when it was read, the broker's average cost and that
	part's own P&L. A part read before its broker signed Maester out is starred and footnoted. P&L
	carries its sign; gain or loss colour repeats it. A figure Maester does not have is "—" with the
	reason read out. Closed by a 2px total row; wide, it scrolls inside its labelled region.
-->
<script lang="ts">
	import { holdingsContent as copy } from '$lib/content/holdings';
	import { direction, percentText, rupees, shares, signedPercent } from '$lib/holdings/format';
	import type { BrokerSummary, HoldingsSnapshot } from '$lib/holdings/types';
	import { olderCloseDay, readShort, staleNote } from '$lib/holdings/view';

	interface Props {
		snapshot: HoldingsSnapshot;
		/** The brokers' manifests (compiled-in plugins) from /v1/brokers. */
		brokers: BrokerSummary[];
	}

	let { snapshot, brokers }: Props = $props();

	const id = $props.id();
	const names = $derived(Object.fromEntries(snapshot.accounts.map((a) => [a.broker, a.name])));
	const footnote = $derived(staleNote(snapshot, new Date(), brokers));
	const t = $derived(snapshot.totals);
	const cols = copy.table.columns;
</script>

{#snippet unknown(reason: string)}
	<span aria-hidden="true">—</span><span class="visually-hidden">{reason}</span>
{/snippet}

{#snippet gain(value: string | null, percent: string | null, reason: string)}
	<td class={['r', 'num', value && direction(value)]}
		>{#if value}{rupees(value, { sign: true })}{:else}{@render unknown(reason)}{/if}</td
	>
	<td class={['r', 'num', percent && direction(percent)]}
		>{#if percent}{signedPercent(percent)}{:else}{@render unknown(reason)}{/if}</td
	>
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
					<th scope="col" class="r">{cols.quantity}</th>
					<th scope="col" class="r">{cols.averagePrice}</th>
					<th scope="col" class="r">{cols.cost}</th>
					<th scope="col" class="r">{cols.close}</th>
					<th scope="col" class="r">{cols.value}</th>
					<th scope="col" class="r">{cols.gain}</th>
					<th scope="col" class="r">{cols.gainPercent}</th>
					<th scope="col" class="r">{cols.weight}</th>
				</tr>
			</thead>
			{#each snapshot.rows as row (row.isin)}
				<tbody>
					<tr class="company">
						<th scope="row">
							<span class="strong">{row.symbol}</span>
							<span class="muted small">{row.exchange} · {row.isin}</span>
						</th>
						<td class="r num strong">{shares(row.quantity)}</td>
						<td></td>
						<td class="r num"
							>{#if row.cost}{rupees(row.cost)}{:else}{@render unknown(copy.table.noCost)}{/if}</td
						>
						<td class="r num"
							>{#if row.close}{rupees(
									row.close.value
								)}{#if olderCloseDay(row, snapshot.closeDay)}<span class="muted small block"
										>{copy.table.closeOn(olderCloseDay(row, snapshot.closeDay)!)}</span
									>{/if}{:else}{@render unknown(copy.table.noClose)}{/if}</td
						>
						<td class="r num strong"
							>{#if row.value}{rupees(row.value)}{:else}{@render unknown(
									copy.table.noClose
								)}{/if}</td
						>
						{@render gain(row.gain, row.gainPercent, copy.table.noGain)}
						<td class="r num"
							>{#if row.weight}{percentText(row.weight)}{:else}{@render unknown(
									copy.table.noClose
								)}{/if}</td
						>
					</tr>
					{#each row.parts as part (part.broker)}
						<tr class="part">
							<th scope="row">
								<span class="broker"
									>{names[part.broker] ?? part.broker}{part.stale ? '*' : ''}</span
								>
								<span class="muted small"
									>{copy.table.brokerLine(part.accountId, readShort(part.readAt))}</span
								>
							</th>
							<td class="r num">{shares(part.quantity)}</td>
							<td class="r num">{rupees(part.averagePrice)}</td>
							<td class="r num"
								>{#if part.cost}{rupees(part.cost)}{:else}{@render unknown(
										copy.table.noCost
									)}{/if}</td
							>
							<td></td>
							<td class="r num"
								>{#if part.value}{rupees(part.value)}{:else}{@render unknown(
										copy.table.noClose
									)}{/if}</td
							>
							{@render gain(part.gain, part.gainPercent, copy.table.noGain)}
							<td></td>
						</tr>
					{/each}
				</tbody>
			{/each}
			<tfoot>
				<tr>
					<th scope="row">{copy.table.total}</th>
					<td></td>
					<td></td>
					<td class="r num"
						>{#if t.cost}{rupees(t.cost)}{:else}{@render unknown(copy.strip.unknown)}{/if}</td
					>
					<td></td>
					<td class="r num"
						>{#if t.knownValue}{rupees(t.knownValue)}{:else}{@render unknown(
								copy.strip.unknown
							)}{/if}</td
					>
					{@render gain(t.unrealizedGain, t.gainPercent, copy.table.noGain)}
					<td></td>
				</tr>
			</tfoot>
		</table>
	</div>
	{#if snapshot.rows.some((r) => r.unknown.includes('NO_CLOSE'))}
		<p class="muted small">{copy.table.noCloseNote}</p>
	{/if}
	{#if footnote}<p class="muted small">{footnote}</p>{/if}
{/if}

<style>
	table {
		width: 100%;
		min-width: 60rem;
		border-collapse: collapse;
		border: var(--rule) solid var(--ink);
	}

	th,
	td {
		padding: var(--space-1) var(--space-4);
		text-align: left;
		vertical-align: baseline;
		font-size: 1rem;
		line-height: var(--leading-small);
		font-weight: 400;
	}

	thead th {
		padding: var(--space-3) var(--space-4);
		font-size: var(--text-sm);
		color: var(--ink-muted);
		border-bottom: var(--rule) solid var(--ink);
	}

	tbody + tbody {
		border-top: var(--rule-thin) solid var(--ink-muted);
	}

	.company th,
	.company td {
		padding-top: var(--space-4);
	}

	tbody tr:last-child th,
	tbody tr:last-child td {
		padding-bottom: var(--space-3);
	}

	tbody th {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	/* A broker's line hangs off its company, marked by a 2px rule: the part belongs to the row above. */
	.part th {
		margin-left: var(--space-1);
		padding-left: var(--space-4);
		border-left: var(--rule) solid var(--ink);
	}

	tfoot tr {
		border-top: var(--rule) solid var(--ink);
	}

	tfoot th,
	tfoot td {
		padding: var(--space-3) var(--space-4);
		font-weight: 700;
	}

	.r {
		text-align: right;
	}

	.strong,
	.company .gain,
	.company .loss {
		font-weight: 700;
	}

	/* The sign carries the direction; the colour repeats it (DESIGN.md §2). */
	.gain {
		color: var(--gain);
	}

	.loss {
		color: var(--loss);
	}

	.block {
		display: block;
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
