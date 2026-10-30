<!--
	Holdings shown by broker (D · final, "Show by: Broker"): one ledger per broker, its holdings with
	the broker's average cost and each part's P&L, closed by the broker's totals, which come from the
	engine (holdings_by_account). A broker whose quantities were read before it signed Maester out
	says so under its ledger. P&L carries its sign; gain or loss colour repeats it. A figure Maester
	does not have, an average cost the broker did not give among them, is "—" with the reason read out.
-->
<script lang="ts">
	import { holdingsContent as copy } from '$lib/content/holdings';
	import { direction, rupees, shares, signedPercent } from '$lib/holdings/format';
	import type { HoldingsSnapshot } from '$lib/holdings/types';
	import { stateWords, totalsOf, whenWords } from '$lib/holdings/view';

	interface Props {
		snapshot: HoldingsSnapshot;
	}

	let { snapshot }: Props = $props();

	const id = $props.id();
	const cols = copy.table.columns;
	const groups = $derived(
		snapshot.accounts
			.map((a) => ({
				account: a,
				totals: totalsOf(snapshot, a.broker),
				lines: snapshot.rows.flatMap((row) =>
					row.parts.filter((p) => p.broker === a.broker).map((part) => ({ row, part }))
				)
			}))
			.filter((g) => g.lines.length > 0)
	);
</script>

{#snippet unknown(reason: string)}
	<span aria-hidden="true">—</span><span class="visually-hidden">{reason}</span>
{/snippet}

{#snippet gain(value: string | null, percent: string | null)}
	<td class={['r', 'num', value && direction(value)]}
		>{#if value}{rupees(value, { sign: true })}{:else}{@render unknown(copy.table.noGain)}{/if}</td
	>
	<td class={['r', 'num', percent && direction(percent)]}
		>{#if percent}{signedPercent(percent)}{:else}{@render unknown(copy.table.noGain)}{/if}</td
	>
{/snippet}

{#if groups.length === 0}
	<p>{copy.table.empty}</p>
{:else}
	<p class="muted small">{copy.table.byBrokerNote}</p>
	{#each groups as g (g.account.broker)}
		<section class="broker" aria-labelledby="{id}-{g.account.broker}">
			<div class="head">
				<h3 id="{id}-{g.account.broker}">{g.account.name}</h3>
				<p>
					<span class={{ strong: g.account.state !== 'signed_in' }}>{stateWords(g.account)}</span>
					{#if g.account.accountId}<span class="muted"> · {g.account.accountId}</span>{/if}
				</p>
			</div>
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div class="scroll-x" role="region" aria-labelledby="{id}-{g.account.broker}" tabindex="0">
				<table>
					<caption class="visually-hidden">{copy.table.byBrokerLabel(g.account.name)}</caption>
					<thead>
						<tr>
							<th scope="col">{cols.companyShort}</th>
							<th scope="col" class="r">{cols.quantity}</th>
							<th scope="col" class="r">{cols.averagePrice}</th>
							<th scope="col" class="r">{cols.cost}</th>
							<th scope="col" class="r">{cols.close}</th>
							<th scope="col" class="r">{cols.value}</th>
							<th scope="col" class="r">{cols.gain}</th>
							<th scope="col" class="r">{cols.gainPercent}</th>
						</tr>
					</thead>
					<tbody>
						{#each g.lines as { row, part } (row.isin)}
							<tr>
								<th scope="row" class="strong">{row.symbol}</th>
								<td class="r num">{shares(part.quantity)}</td>
								<td class="r num"
									>{#if part.averagePrice}{rupees(part.averagePrice)}{:else}{@render unknown(
											copy.table.noCost
										)}{/if}</td
								>
								<td class="r num"
									>{#if part.cost}{rupees(part.cost)}{:else}{@render unknown(
											copy.table.noCost
										)}{/if}</td
								>
								<td class="r num"
									>{#if row.close}{rupees(row.close.value)}{:else}{@render unknown(
											copy.table.noClose
										)}{/if}</td
								>
								<td class="r num"
									>{#if part.value}{rupees(part.value)}{:else}{@render unknown(
											copy.table.noClose
										)}{/if}</td
								>
								{@render gain(part.gain, part.gainPercent)}
							</tr>
						{/each}
					</tbody>
					{#if g.totals}
						<tfoot>
							<tr>
								<th scope="row">{copy.table.brokerTotal}</th>
								<td></td>
								<td></td>
								<td class="r num"
									>{#if g.totals.cost}{rupees(g.totals.cost)}{:else}{@render unknown(
											copy.table.noCost
										)}{/if}</td
								>
								<td></td>
								<td class="r num"
									>{#if g.totals.knownValue}{rupees(g.totals.knownValue)}{:else}{@render unknown(
											copy.strip.unknown
										)}{/if}</td
								>
								{@render gain(g.totals.gain, g.totals.gainPercent)}
							</tr>
						</tfoot>
					{/if}
				</table>
			</div>
			{#if g.account.state !== 'signed_in' && g.account.lastReadAt}
				<p class="muted small">
					{copy.table.byBrokerStale(whenWords(g.account.lastReadAt), g.account.name)}
				</p>
			{/if}
		</section>
	{/each}
{/if}

<style>
	.broker {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.broker + .broker {
		margin-top: var(--space-6);
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--space-2) var(--space-4);
	}

	h3 {
		margin: 0;
		font-stretch: var(--wdth-heading);
		font-weight: 700;
		font-size: var(--text-md);
		line-height: 1.2;
	}

	.head p {
		margin: 0;
		font-size: 1rem;
	}

	table {
		width: 100%;
		min-width: 52rem;
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

	/* The sign carries the direction; the colour repeats it (DESIGN.md §2). */
	.gain {
		color: var(--gain);
	}

	.loss {
		color: var(--loss);
	}

	.small {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
	}

	p.small {
		margin: 0;
		max-width: var(--measure);
	}
</style>
