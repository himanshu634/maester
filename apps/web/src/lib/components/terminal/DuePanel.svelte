<script lang="ts">
	/**
	 * The inverted "Due this week" panel. Decisions come before data fixes; the first item
	 * opens with its trigger, evidence and the call to make, the rest are one-line rows.
	 * When nothing is due it lists what was checked, because silence is a checked answer.
	 * The write actions are disabled in the demo and described by the page's read-only note.
	 */
	import { terminalContent } from '$lib/content/terminal';
	import type { Check, DueItem } from '$lib/terminal/due';
	import { dueDetail } from '$lib/terminal/fixture';
	import { dueRow, hasDetail } from '$lib/terminal/overview';
	import type { Valuation } from '$lib/terminal/portfolio';

	interface Props {
		headingId: string;
		noteId: string;
		items: readonly DueItem[];
		valuation: Valuation;
		limit: number;
		checks: readonly Check[];
	}

	let { headingId, noteId, items, valuation, limit, checks }: Props = $props();

	const due = terminalContent.due;
	const actions = terminalContent.actions;
	let detailed = $derived(items.length > 0 && hasDetail(items[0]));
	let rows = $derived(
		(detailed ? items.slice(1) : items).map((item) => ({
			key: `${item.kind}:${item.holding}`,
			...dueRow(item, valuation, limit)
		}))
	);
</script>

<section class="due inverted" aria-labelledby={headingId}>
	{#if items.length === 0}
		<div class="head quiet">
			<h2 id={headingId}>{due.quietHeading}</h2>
			<p class="muted lede">{due.quietLede}</p>
		</div>
		<div class="body checks">
			<dl class="spec">
				{#each checks as check (check.label)}
					<div class="entry">
						<dt>{check.label}</dt>
						<dd>{check.detail}</dd>
					</div>
				{/each}
			</dl>
		</div>
	{:else}
		<div class="head">
			<h2 id={headingId}>{due.heading}</h2>
			<p class="muted">{due.subtitle(items.length)}</p>
		</div>
		{#if detailed}
			<div class="body">
				<div class="title-row">
					<h3>{dueDetail.title}</h3>
					<span class="tag">{dueDetail.tag}</span>
				</div>
				<p class="muted">{dueDetail.meta}</p>
				<dl class="spec">
					<div class="entry">
						<dt>{due.labels.trigger}</dt>
						<dd>{dueDetail.trigger}</dd>
					</div>
					<div class="entry">
						<dt>{due.labels.evidence}</dt>
						<dd>{dueDetail.evidence}</dd>
					</div>
					<div class="entry">
						<dt>{due.labels.call}</dt>
						<dd>{dueDetail.call}</dd>
					</div>
				</dl>
				<div class="actions">
					<button class="button primary" type="button" disabled aria-describedby={noteId}>
						{actions.startReview}
					</button>
					<button class="button secondary" type="button" disabled aria-describedby={noteId}>
						{actions.moveToNextWeek}
					</button>
				</div>
			</div>
		{/if}
		{#if rows.length > 0}
			<ul class="rows">
				{#each rows as row (row.key)}
					<li class="row">
						<p class="row-title">{row.title}</p>
						{#if row.detail}<p class="muted num">{row.detail}</p>{/if}
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</section>

<style>
	/* Full bleed on a phone: the panel cancels the shell's 24px gutter, as frame C2 does. */
	.due {
		background: var(--ink);
		color: var(--paper);
		margin: 0 calc(-1 * var(--space-6));
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-2) var(--space-4);
		padding: var(--space-4) var(--space-5);
		border-bottom: var(--rule) solid var(--paper);
	}

	.head.quiet {
		flex-direction: column;
		align-items: stretch;
		padding: var(--space-6) var(--space-5);
	}

	h2 {
		font-stretch: var(--wdth-heading);
		font-weight: 700;
		font-size: 1.5rem;
		line-height: var(--leading-heading);
		letter-spacing: var(--tracking-heading);
	}

	.head p {
		font-size: 1rem;
	}

	.head .lede {
		font-size: var(--text-base);
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-5);
	}

	.body.checks {
		padding-top: var(--space-2);
	}

	.title-row {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-3);
	}

	h3 {
		min-width: 0;
		font-stretch: var(--wdth-heading);
		font-weight: 700;
		font-size: var(--text-lg);
		line-height: 1.2;
	}

	.tag {
		border: 1.5px solid var(--paper);
		padding: var(--space-1) var(--space-2);
		font-size: var(--text-sm);
		line-height: 1.2;
		white-space: nowrap;
	}

	.body > p {
		font-size: 1rem;
	}

	.spec {
		margin: 0;
		border-top: var(--rule) solid var(--paper);
		border-bottom: var(--rule) solid var(--paper);
	}

	.entry {
		display: grid;
		grid-template-columns: 84px minmax(0, 1fr);
		gap: var(--space-4);
		padding: var(--space-3) 0;
		font-size: 1rem;
		line-height: var(--leading-small);
	}

	.checks .entry {
		grid-template-columns: 112px minmax(0, 1fr);
	}

	.entry + .entry {
		border-top: var(--rule-thin) solid var(--paper);
	}

	dt {
		font-weight: 700;
	}

	dd {
		margin: 0;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}

	.actions .button {
		width: 100%;
		white-space: nowrap;
	}

	/* Enabled colours only; a disabled button takes the global .button:disabled style. */
	.due .primary:not(:disabled) {
		background: var(--paper);
		color: var(--ink);
	}

	.due .secondary:not(:disabled) {
		background: transparent;
		color: var(--paper);
	}

	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.row {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: 14px var(--space-5);
		border-top: var(--rule-thin) solid var(--paper);
	}

	.row-title {
		font-weight: 700;
	}

	.row .muted {
		font-size: var(--text-sm);
	}

	@media (min-width: 768px) {
		.due {
			margin: 0;
		}

		.head {
			padding: 18px var(--space-7);
		}

		.head.quiet {
			padding: var(--space-6) var(--space-7);
		}

		h2 {
			font-size: var(--text-xl);
		}

		.body {
			padding: var(--space-6) var(--space-7) var(--space-7);
		}

		.body.checks {
			padding: var(--space-2) var(--space-7) var(--space-6);
		}

		h3 {
			flex: 1;
			font-size: 1.625rem;
		}

		.entry {
			grid-template-columns: 140px minmax(0, 1fr);
		}

		.checks .entry {
			grid-template-columns: 160px minmax(0, 1fr);
		}

		.actions .button {
			width: auto;
		}

		.row {
			display: grid;
			grid-template-columns: minmax(0, 1fr) 320px;
			gap: var(--space-6);
			align-items: baseline;
			padding: var(--space-4) var(--space-7);
		}

		.row .muted {
			font-size: 1rem;
		}
	}
</style>
