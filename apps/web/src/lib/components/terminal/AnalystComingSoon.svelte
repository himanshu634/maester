<!--
	The Analyst page until its first step works: the coming-soon page with the lamp, what runs
	today, how a review will run and the rule that every number has a source (DESIGN.md sections 5
	and 10; plan: docs/superpowers/specs/2026-10-15-agents-design.md).
-->
<script lang="ts">
	import { terminalContent } from '$lib/content/terminal';
	import ComingSoon from './ComingSoon.svelte';
	import ReviewSteps from './ReviewSteps.svelte';
	import LampSketch from './sketches/LampSketch.svelte';
	import Notice from '../auth/Notice.svelte';

	const copy = terminalContent.comingSoon.pages.analyst;
	const desk = copy.desk;
</script>

<div class="page">
	<ComingSoon page="analyst">
		{#snippet sketch()}
			<LampSketch label={copy.sketch.label} lines={copy.sketch} />
		{/snippet}
		<Notice title={desk.today.title} role="note">
			<p>{desk.today.body}</p>
		</Notice>
	</ComingSoon>

	<section aria-labelledby="review-steps">
		<h2 id="review-steps">{desk.stepsHeading}</h2>
		<ReviewSteps steps={desk.steps} labels={desk.labels} />
	</section>

	<section aria-labelledby="review-sources" class="sources">
		<h2 id="review-sources">{desk.sourceHeading}</h2>
		<p>{desk.sourceBody}</p>
	</section>
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		gap: var(--space-10);
	}

	section {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	h2 {
		font-stretch: var(--wdth-heading);
		font-weight: 700;
		font-size: var(--text-lg);
		line-height: var(--leading-heading);
		letter-spacing: var(--tracking-heading);
	}

	.sources p {
		max-width: var(--measure);
	}
</style>
