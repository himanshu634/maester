<!--
	Filings by company, for Working on and for Done: each company is a heading, each filing a row
	with its title (an underlined button that opens it), its files, and its Numbers and Text tracks
	in a hairline box on the right. Nothing here is an ink block. With `collapse`, a company shows
	its newest filings until "Show all".
-->
<script lang="ts">
	import { documentsContent as copy } from '$lib/content/documents';
	import {
		fileLine,
		shownFilings,
		showAllLabel,
		type CompanyGroup,
		type FilingView
	} from '$lib/documents/filings';
	import Track from './Track.svelte';

	interface Props {
		heading: string;
		/** "4 filings · 7 files". */
		count: string;
		groups: CompanyGroup[];
		/** Show each company's newest filings only, with "Show all" for the rest. */
		collapse: boolean;
		openedKey: string | null;
		onopen: (view: FilingView) => void;
		/** Makes the headings' ids unique per list: `{idPrefix}-heading`, `{idPrefix}-co-{companyId}`. */
		idPrefix: string;
	}

	let { heading, count, groups, collapse, openedKey, onopen, idPrefix }: Props = $props();

	const id = $props.id();
	/** The companies whose whole list the investor asked for. */
	let expandedBy = $state<Record<string, boolean>>({});

	const groupId = (group: CompanyGroup) => group.companyId ?? 'none';

	/**
	 * What a group shows. The open filing is never left behind "Show all": a group holding it past
	 * the newest few shows them all, and then has no way to fold back.
	 */
	function view(group: CompanyGroup) {
		if (!collapse) return { shown: group.filings, button: null as string | null, expanded: true };
		const asked = expandedBy[groupId(group)] ?? false;
		const newest = shownFilings(group, false).shown;
		const pinned =
			!asked &&
			openedKey !== null &&
			newest.every((f) => f.key !== openedKey) &&
			group.filings.some((f) => f.key === openedKey);
		const expanded = asked || pinned;
		const { shown } = shownFilings(group, expanded);
		const folds = group.filings.length > newest.length;
		return {
			shown,
			button: folds && !pinned ? showAllLabel(group, expanded) : null,
			expanded
		};
	}
</script>

<section class="filings" aria-labelledby="{idPrefix}-heading">
	<h2 id="{idPrefix}-heading" tabindex="-1">
		{heading}
		<span class="count muted">{count}</span>
	</h2>
	{#each groups as group (groupId(group))}
		{@const shown = view(group)}
		<div class="group">
			<h3 id="{idPrefix}-co-{groupId(group)}" tabindex="-1">
				{group.name}
				{#if group.codes}<span class="codes muted">{group.codes}</span>{/if}
			</h3>
			<ul id="{id}-{groupId(group)}-list">
				{#each shown.shown as filing (filing.key)}
					{@const opened = filing.key === openedKey}
					<li class={{ opened }}>
						<div class="what">
							<button
								class="title"
								type="button"
								aria-current={opened ? 'true' : undefined}
								onclick={() => onopen(filing)}
							>
								{filing.title}
							</button>
							{#each filing.files as file (file.documentId)}
								<p class="file">{fileLine(file)}</p>
							{/each}
						</div>
						<div class="tracks">
							<Track label={copy.tracks.numbersLabel} words={filing.numbers} />
							<Track label={copy.tracks.textLabel} words={filing.text} />
						</div>
					</li>
				{/each}
			</ul>
			{#if shown.button}
				<button
					class="text-button"
					type="button"
					aria-expanded={shown.expanded}
					aria-controls="{id}-{groupId(group)}-list"
					onclick={() => (expandedBy[groupId(group)] = !shown.expanded)}
				>
					{shown.button}
				</button>
			{/if}
		</div>
	{/each}
</section>

<style>
	.filings {
		min-width: 0;
		container-type: inline-size;
	}

	h2 {
		font-stretch: var(--wdth-heading);
		font-weight: 700;
		font-size: var(--text-lg);
		line-height: var(--leading-heading);
		letter-spacing: var(--tracking-heading);
		margin-bottom: var(--space-2);
	}

	.count {
		margin-left: var(--space-2);
		font-size: 1rem;
		font-stretch: var(--wdth-body);
		font-weight: 400;
		letter-spacing: 0;
	}

	.group {
		margin-top: var(--space-4);
	}

	h3 {
		font-size: 1rem;
		font-weight: 700;
		line-height: var(--leading-small);
		margin-bottom: var(--space-1);
	}

	.codes {
		margin-left: var(--space-2);
		font-size: var(--text-sm);
		font-weight: 400;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		border-bottom: var(--rule) solid var(--ink);
	}

	li {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-2) var(--space-4);
		padding: var(--space-2) 0 var(--space-3);
		border-top: var(--rule-thin) solid var(--ink-muted);
		font-size: 1rem;
		line-height: var(--leading-small);
	}

	li.opened {
		padding-left: var(--space-3);
		border-left: var(--rule) solid var(--ink);
	}

	.what {
		min-width: 0;
	}

	.title {
		min-height: var(--target);
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		font-weight: 700;
		text-align: left;
		overflow-wrap: anywhere;
		text-decoration: underline;
		text-underline-offset: 3px;
		text-decoration-thickness: 1.5px;
		cursor: pointer;
	}

	.title:hover {
		background: var(--ink);
		color: var(--paper);
		text-decoration: none;
	}

	.file {
		font-size: var(--text-sm);
		color: var(--ink-muted);
		overflow-wrap: anywhere;
	}

	.tracks {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
		padding: var(--space-2) var(--space-3);
		border: var(--rule-thin) solid var(--ink-muted);
	}

	.text-button {
		min-height: var(--target);
		margin-top: var(--space-1);
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		font-weight: 700;
		text-align: left;
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

	@container (min-width: 36rem) {
		li {
			grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.6fr);
			align-items: start;
		}
	}
</style>
