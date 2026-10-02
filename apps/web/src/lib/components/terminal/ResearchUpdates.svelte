<script lang="ts">
	/** What was read this week about companies you own: a title, a date and one line. */
	import { terminalContent } from '$lib/content/terminal';
	import type { ResearchItem } from '$lib/terminal/fixture';

	interface Props {
		headingId: string;
		items: readonly ResearchItem[];
	}

	let { headingId, items }: Props = $props();

	const copy = terminalContent.research;
</script>

<section aria-labelledby={headingId}>
	<div class="head">
		<h2 id={headingId}>{copy.heading}</h2>
		<span class="muted aside">{copy.aside}</span>
	</div>
	<ul class="items">
		{#each items as item (item.title)}
			<li class="item">
				<div class="title-row">
					<h3>{item.title}</h3>
					<span class="muted when">{item.when}</span>
				</div>
				<p>{item.body}</p>
			</li>
		{/each}
	</ul>
</section>

<style>
	section {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		min-width: 0;
	}

	.head,
	.title-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3) var(--space-4);
	}

	h2 {
		font-stretch: var(--wdth-heading);
		font-weight: 700;
		font-size: var(--text-lg);
		line-height: var(--leading-heading);
		letter-spacing: var(--tracking-heading);
	}

	.aside,
	.when {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
		white-space: nowrap;
	}

	.items {
		list-style: none;
		margin: 0;
		padding: 0;
		border-top: var(--rule) solid var(--ink);
	}

	.item {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: 14px 0;
		border-bottom: var(--rule-thin) solid var(--ink-muted);
	}

	h3 {
		font-size: var(--text-base);
		line-height: var(--leading-body);
		font-weight: 700;
	}

	p {
		font-size: 1rem;
		line-height: var(--leading-body);
	}
</style>
