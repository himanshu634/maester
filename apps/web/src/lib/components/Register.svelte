<script lang="ts">
	/**
	 * The page's repeating structure: a full-bleed band closed by a 2px rule,
	 * holding a capped-width grid with a rail on the left carrying the section
	 * label and content on the right. Below 1024px the rail folds above the
	 * content. Rules always run edge to edge; only the content is capped.
	 */
	import type { Snippet } from 'svelte';

	interface Props {
		id?: string;
		label: string;
		headingId: string;
		inverted?: boolean;
		as?: 'section' | 'footer';
		children: Snippet;
		rail?: Snippet;
	}

	let { id, label, headingId, inverted = false, as = 'section', children, rail }: Props = $props();
</script>

<svelte:element
	this={as}
	{id}
	class={['register', { inverted }]}
	aria-labelledby={as === 'section' ? headingId : undefined}
>
	<div class="inner">
		<div class="rail">
			{#if rail}
				{@render rail()}
			{:else}
				<span class="muted">{label}</span>
			{/if}
		</div>
		<div class="content">
			{@render children()}
		</div>
	</div>
</svelte:element>

<style>
	.register {
		border-bottom: var(--rule) solid var(--ink);
	}

	.register.inverted {
		background: var(--ink);
		color: var(--paper);
	}

	.inner {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		max-width: var(--max-width);
		margin: 0 auto;
	}

	.rail {
		padding: var(--space-6) var(--gutter) 0 var(--gutter);
		font-size: var(--text-sm);
		line-height: 1.6;
	}

	.content {
		padding: var(--space-8) var(--gutter) var(--space-10) var(--gutter);
	}

	@media (min-width: 1024px) {
		.inner {
			grid-template-columns: var(--rail) minmax(0, 1fr);
		}

		.rail {
			padding: var(--space-12) var(--space-6) var(--space-12) var(--gutter);
			border-right: var(--rule) solid var(--ink);
		}

		.inverted .rail {
			border-right-color: var(--paper);
		}

		.rail > :global(*) {
			position: sticky;
			top: var(--space-6);
		}

		.content {
			padding: var(--space-12) var(--gutter) var(--space-14) var(--gutter);
		}
	}
</style>
