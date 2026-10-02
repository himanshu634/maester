<script lang="ts">
	/**
	 * Every holding, largest value first, closed by a totals row. A holding with no price
	 * shows "—" with the reason read out, never a zero. All five columns show at every
	 * width; on a narrow screen the table scrolls inside its own region, never the page.
	 */
	import { terminalContent } from '$lib/content/terminal';
	import { inr, percent, price, quantity } from '$lib/terminal/format';
	import type { Valuation } from '$lib/terminal/portfolio';

	interface Props {
		headingId: string;
		valuation: Valuation;
	}

	let { headingId, valuation }: Props = $props();

	const copy = terminalContent.holdings;
	const columns = copy.columns;
</script>

{#snippet unknown()}
	<span aria-hidden="true">—</span><span class="visually-hidden">{copy.noPrice}</span>
{/snippet}

<section aria-labelledby={headingId}>
	<h2 id={headingId}>{copy.heading}</h2>
	<!-- A region that scrolls must take focus so keyboard users can scroll it (WCAG 2.1.1). -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div class="scroll-x" role="region" aria-label={copy.heading} tabindex="0">
		<table>
			<caption class="visually-hidden">{copy.heading}</caption>
			<thead>
				<tr>
					<th scope="col">{columns.company}</th>
					<th scope="col" class="figure">{columns.quantity}</th>
					<th scope="col" class="figure">{columns.price}</th>
					<th scope="col" class="figure">{columns.value}</th>
					<th scope="col" class="figure">{columns.weight}</th>
				</tr>
			</thead>
			<tbody>
				{#each valuation.holdings as h (h.name)}
					<tr>
						<th scope="row">{h.name}</th>
						<td class="figure num">{quantity(h.quantity)}</td>
						<td class="figure num">
							{#if h.price === null}{@render unknown()}{:else}{price(h.price)}{/if}
						</td>
						<td class="figure num">
							{#if h.value === null}{@render unknown()}{:else}{inr(h.value)}{/if}
						</td>
						<td class="figure num">
							{#if h.weight === null}{@render unknown()}{:else}{percent(h.weight)}{/if}
						</td>
					</tr>
				{/each}
			</tbody>
			<tfoot>
				<tr>
					<th scope="row">{copy.pricedOf(valuation.priced, valuation.count)}</th>
					<td></td>
					<td></td>
					<td class="figure num">
						{#if valuation.priced > 0}{inr(valuation.knownValue)}{:else}{@render unknown()}{/if}
					</td>
					<td class="figure num">
						{#if valuation.priced > 0}{percent(100)}{:else}{@render unknown()}{/if}
					</td>
				</tr>
			</tfoot>
		</table>
	</div>
</section>

<style>
	section {
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

	table {
		width: 100%;
		border-collapse: collapse;
		border: var(--rule) solid var(--ink);
		font-size: 1rem;
		line-height: var(--leading-small);
	}

	/* 12px at the box edges, 16px between columns. */
	th,
	td {
		padding: 10px var(--space-2);
		text-align: left;
		vertical-align: baseline;
	}

	tr > :first-child {
		padding-left: var(--space-3);
	}

	tr > :last-child {
		padding-right: var(--space-3);
	}

	/* Names stay on one line; a narrow screen scrolls the region instead of squeezing them. */
	th {
		font-weight: 400;
		white-space: nowrap;
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
		font-weight: 700;
	}

	tfoot th {
		font-weight: 700;
	}

	.figure {
		text-align: right;
		white-space: nowrap;
	}

	@media (min-width: 768px) {
		th,
		td {
			padding: var(--space-3) var(--space-2);
		}

		tr > :first-child {
			padding-left: var(--space-4);
		}

		tr > :last-child {
			padding-right: var(--space-4);
		}
	}
</style>
