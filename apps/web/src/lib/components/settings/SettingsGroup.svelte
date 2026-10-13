<!--
	A group of settings: an h2, an optional lede, then its items, closed by a 2px rule. New
	settings arrive as new groups or items, so the page grows without a redesign.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		heading: string;
		lede?: string;
		children: Snippet;
	}

	let { heading, lede, children }: Props = $props();

	const id = $props.id();
</script>

<section class="group" aria-labelledby="{id}-heading">
	<div class="head">
		<h2 id="{id}-heading">{heading}</h2>
		{#if lede}<p class="muted">{lede}</p>{/if}
	</div>
	{@render children()}
	<div class="close"></div>
</section>

<style>
	.group {
		display: flex;
		flex-direction: column;
		max-width: 70rem;
	}

	.head {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding-bottom: var(--space-3);
	}

	h2 {
		font-stretch: var(--wdth-heading);
		font-weight: 700;
		font-size: var(--text-lg);
		line-height: var(--leading-heading);
		letter-spacing: var(--tracking-heading);
	}

	.head p {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
		max-width: var(--measure);
	}

	.close {
		border-top: var(--rule) solid var(--ink);
	}

	@media (min-width: 768px) {
		h2 {
			font-size: var(--text-xl);
		}
	}
</style>
