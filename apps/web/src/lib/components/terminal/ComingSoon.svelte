<!--
	A signed-in page that does not work yet. The page name, a "Coming soon" tag, one sentence on
	what the page will do for the investor and one on what it needs first. No primary action:
	there is nothing to do here yet. The page's sketch, when it has one, sits beside the text from
	1024px and below it on smaller screens; it is decoration you can play with, never a control,
	so the text and any link come first.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { terminalContent } from '$lib/content/terminal';
	import { terminalPage, type ComingSoonKey } from '$lib/terminal/pages';

	interface Props {
		page: ComingSoonKey;
		/** The page's sketch. */
		sketch?: Snippet;
		/** Anything that follows the two sentences, such as a link. */
		children?: Snippet;
	}

	let { page, sketch, children }: Props = $props();

	let label = $derived(terminalPage(page).label);
	let copy = $derived(terminalContent.comingSoon.pages[page]);
</script>

<div class={['soon', { solo: !sketch }]}>
	<div class="text">
		<div class="title">
			<h1>{label}</h1>
			<span class="tag">{terminalContent.comingSoon.tag}</span>
		</div>
		<p class="what">{copy.what}</p>
		<p class="needs">{copy.needs}</p>
		{@render children?.()}
	</div>
	{#if sketch}
		<figure>
			{@render sketch()}
		</figure>
	{/if}
</div>

<style>
	.soon {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-8);
		align-items: start;
	}

	.text {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-5);
		min-width: 0;
		max-width: 560px;
	}

	.title {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3) var(--space-4);
	}

	h1 {
		font-stretch: var(--wdth-wide);
		font-weight: 800;
		font-size: 2rem;
		line-height: var(--leading-heading);
		letter-spacing: var(--tracking-heading);
	}

	.tag {
		border: 1.5px solid var(--ink);
		padding: var(--space-1) var(--space-2);
		font-size: var(--text-sm);
		line-height: 1.2;
	}

	.needs {
		font-size: 1rem;
	}

	figure {
		margin: 0;
		width: 100%;
		max-width: 520px;
	}

	@media (min-width: 768px) {
		h1 {
			font-size: var(--text-2xl);
		}
	}

	@media (min-width: 1024px) {
		.soon:not(.solo) {
			grid-template-columns: minmax(0, 520px) minmax(0, 520px);
			gap: var(--space-12);
		}

		.text {
			padding-top: var(--space-2);
		}
	}
</style>
