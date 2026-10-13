<!--
	The Research list: the investor's companies, each with how many annual reports were read, the
	latest year and where it stands, in words. A company's name opens its page. A company appears
	once a filing of it is added; its figures appear once an annual report is read.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { researchContent as copy } from '$lib/content/research';
	import { readMe, type Fetcher } from '$lib/documents/client';
	import { researchApi } from '$lib/research/client';
	import { companyHref } from '$lib/research/links';
	import type { ResearchCompany } from '$lib/research/types';
	import { fyLabel, readFrom, standing } from '$lib/research/view';
	import SectionIssue from '$lib/components/errors/SectionIssue.svelte';
	import Hatch from '$lib/components/loading/Hatch.svelte';

	const id = $props.id();
	const fetcher: Fetcher = (url, init) => fetch(url, init);

	let load = $state<'loading' | 'failed' | 'no-workspace' | 'ready'>('loading');
	let items = $state.raw<ResearchCompany[]>([]);

	async function start() {
		load = 'loading';
		try {
			const me = await readMe(fetcher);
			const workspace = me.workspaces[0];
			if (!workspace) {
				load = 'no-workspace';
				return;
			}
			items = (await researchApi(fetcher, workspace.id).companies()).items;
			load = 'ready';
		} catch {
			load = 'failed';
		}
	}

	onMount(start);
</script>

<div class="research">
	<div class="intro">
		<h1>{copy.heading}</h1>
		<p class="lede">{copy.lede}</p>
	</div>

	{#if load === 'loading'}
		<div class="skeleton" aria-busy="true" aria-describedby="{id}-waiting">
			<Hatch width="50%" height="1.25rem" />
			{#each [1, 2, 3] as row (row)}
				<Hatch height="2.75rem" />
			{/each}
		</div>
		<p class="waiting" id="{id}-waiting" role="status">{copy.loading}</p>
	{:else if load === 'failed'}
		<SectionIssue
			title={copy.loadFailed.title}
			detail={copy.loadFailed.detail}
			retryLabel={copy.loadFailed.retry}
			onretry={start}
		/>
	{:else if load === 'no-workspace'}
		<SectionIssue title={copy.noWorkspace.title} detail={copy.noWorkspace.detail} />
	{:else if items.length === 0}
		<p class="empty">{copy.empty}</p>
		<p><a href={resolve('/terminal/documents')}>{copy.addFiling}</a></p>
	{:else}
		<p class="muted count">{copy.count(items.length)}</p>
		<!-- A region that scrolls must take focus so keyboard users can scroll it (WCAG 2.1.1). -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div class="list">
			<div class="scroll-x" role="region" aria-label={copy.listLabel} tabindex="0">
				<table>
					<caption class="visually-hidden">{copy.listLabel}</caption>
					<thead>
						<tr>
							<th scope="col">{copy.columns.company}</th>
							<th scope="col" class="wide">{copy.columns.readFrom}</th>
							<th scope="col" class="wide">{copy.columns.latest}</th>
							<th scope="col">{copy.columns.standing}</th>
						</tr>
					</thead>
					<tbody>
						{#each items as item (item.company.id)}
							<tr>
								<th scope="row" class="name">
									<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the id is known only at runtime; the path is resolve()d -->
									<a href={companyHref(item.company.id)}>{item.company.displayName}</a>
									<!-- In a narrow column the two middle columns fold into the name's cell. -->
									<span class="folded muted">
										{copy.folded(
											readFrom(item.annualReportsRead),
											item.latestPeriodEnd ? fyLabel(item.latestPeriodEnd) : null
										)}
									</span>
								</th>
								<td class="wide">{readFrom(item.annualReportsRead)}</td>
								<td class="wide num">
									{#if item.latestPeriodEnd}
										{fyLabel(item.latestPeriodEnd)}
									{:else}
										<span aria-hidden="true">—</span><span class="visually-hidden"
											>{copy.noLatest}</span
										>
									{/if}
								</td>
								<td>{standing(item)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
		<p class="missing">
			{copy.missingCompany}
			<a href={resolve('/terminal/documents')}>{copy.addFiling}</a>
		</p>
	{/if}
</div>

<style>
	.research {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		min-width: 0;
	}

	.intro {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	h1 {
		font-stretch: var(--wdth-wide);
		font-weight: 800;
		font-size: 2rem;
		line-height: var(--leading-heading);
		letter-spacing: var(--tracking-heading);
	}

	.lede,
	.empty {
		max-width: var(--measure);
	}

	.skeleton {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.waiting,
	.count,
	.missing {
		font-size: 1rem;
	}

	.count {
		margin-bottom: calc(-1 * var(--space-3));
	}

	table {
		width: 100%;
		border-collapse: collapse;
		border: var(--rule) solid var(--ink);
		font-size: 1rem;
		line-height: var(--leading-small);
	}

	th,
	td {
		padding: 10px var(--space-2);
		text-align: left;
		vertical-align: top;
	}

	tr > :first-child {
		padding-left: var(--space-3);
	}

	tr > :last-child {
		padding-right: var(--space-3);
	}

	th {
		font-weight: 400;
	}

	thead th {
		font-size: var(--text-sm);
		color: var(--ink-muted);
		border-bottom: var(--rule) solid var(--ink);
		vertical-align: bottom;
	}

	tbody tr + tr {
		border-top: var(--rule-thin) solid var(--ink-muted);
	}

	.list {
		container-type: inline-size;
	}

	.name {
		font-weight: 700;
	}

	.folded {
		display: block;
		font-weight: 400;
		font-size: var(--text-sm);
	}

	.wide {
		display: none;
	}

	@container (min-width: 36rem) {
		.folded {
			display: none;
		}

		.wide {
			display: table-cell;
		}
	}

	/* A 44px target for the name, without making the row taller than it needs. */
	.name a {
		display: inline-block;
		padding: 11px 0;
		margin: -11px 0;
	}

	@media (min-width: 768px) {
		th,
		td {
			padding: var(--space-3) var(--space-4);
		}

		tr > :first-child {
			padding-left: var(--space-4);
		}

		tr > :last-child {
			padding-right: var(--space-4);
		}

		td {
			white-space: nowrap;
		}

		h1 {
			font-size: var(--text-2xl);
		}
	}
</style>
