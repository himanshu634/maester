<script lang="ts">
	/**
	 * The sign-in pages' frame: masthead, a 480px panel with a 2px rule, and on /login
	 * the sketched illustration (right of the panel from 1024px, a square below it).
	 */
	import type { Snippet } from 'svelte';
	import { content } from '$lib/content';
	import Masthead from '$lib/components/Masthead.svelte';
	import LoginIllustration from '$lib/components/LoginIllustration.svelte';

	interface Props {
		illustration?: boolean;
		children: Snippet;
	}

	let { illustration = false, children }: Props = $props();
</script>

<div class="page">
	<Masthead {...content.masthead} />
	<main id="main" class={['auth', { 'with-scene': illustration }]}>
		<div class="panel">
			{@render children()}
		</div>
		{#if illustration}
			<figure class="scene">
				<LoginIllustration />
			</figure>
		{/if}
	</main>
</div>

<style>
	/* Masthead, then everything left of the screen. A grid, because its 1fr row respects min-height. */
	.page {
		min-height: 100dvh;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
	}

	.auth {
		width: 100%;
		max-width: var(--max-width);
		margin: 0 auto;
		padding: var(--space-12) var(--gutter) var(--space-14) var(--gutter);
		display: grid;
		grid-template-columns: minmax(0, 480px);
		align-content: start;
		gap: var(--space-10);
	}

	.panel {
		width: 100%;
		border: var(--rule) solid var(--ink);
		padding: var(--space-6);
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.panel :global(h1) {
		font-stretch: var(--wdth-wide);
		font-weight: 800;
		font-size: var(--text-xl);
		line-height: var(--leading-heading);
		letter-spacing: var(--tracking-heading);
	}

	.panel :global(.small) {
		font-size: var(--text-sm);
	}

	.panel :global(.links) {
		padding-top: var(--space-4);
		border-top: var(--rule-thin) solid var(--ink-muted);
		font-size: 1rem;
	}

	.panel :global(.status) {
		font-size: var(--text-sm);
		min-height: 1.5em;
	}

	/* The drawing's rounded frame. The radius is the illustration's, not the layout's (docs/DESIGN.md, section 5). */
	.scene {
		position: relative;
		margin: 0;
		width: 100%;
		max-width: 640px;
		aspect-ratio: 1;
		border: 3px solid var(--ink);
		border-radius: 30px; /* design-guard: allow */
		background: var(--paper);
		overflow: hidden;
	}

	/* Out of flow, so the drawing takes the frame's size instead of setting it. */
	.scene > :global(svg) {
		position: absolute;
		inset: 0;
	}

	@media (min-width: 768px) {
		.panel {
			padding: var(--space-8);
		}

		.panel :global(h1) {
			font-size: var(--text-2xl);
		}
	}

	@media (min-width: 1024px) {
		.auth.with-scene {
			grid-template-columns: minmax(0, 480px) minmax(0, 1fr);
			grid-template-rows: minmax(0, 1fr);
			align-content: stretch;
			gap: var(--gutter);
			padding: var(--gutter);
		}

		.panel {
			align-self: start;
		}

		/* Fills the column from the masthead to the bottom of the screen. */
		.scene {
			max-width: none;
			aspect-ratio: auto;
			min-height: 0;
			height: 100%;
		}
	}
</style>
