<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Link } from '$lib/content';

	interface Props {
		headingId: string;
		heading: string;
		paragraphs: readonly string[];
		cta: Link;
	}

	let { headingId, heading, paragraphs, cta }: Props = $props();
</script>

<h2 id={headingId}>{heading}</h2>
<div class="body">
	{#each paragraphs as paragraph (paragraph)}
		<p class="measure">{paragraph}</p>
	{/each}
</div>
<a class="button" href={resolve(cta.href)}>{cta.label}</a>

<style>
	h2 {
		font-stretch: var(--wdth-heading);
		font-weight: 700;
		font-size: var(--text-xl);
		line-height: var(--leading-heading);
		letter-spacing: var(--tracking-heading);
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		margin: var(--space-4) 0 var(--space-7) 0;
	}

	@media (min-width: 768px) {
		h2 {
			font-size: var(--text-2xl);
		}

		.body {
			margin-top: var(--space-5);
		}
	}
</style>
