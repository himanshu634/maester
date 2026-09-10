<script lang="ts">
	import type { Principle } from '$lib/content';

	interface Props {
		headingId: string;
		heading: string;
		intro: string;
		principles: readonly Principle[];
		measured: string;
	}

	let { headingId, heading, intro, principles, measured }: Props = $props();
</script>

<h2 id={headingId}>{heading}</h2>
<p class="measure intro">{intro}</p>

<dl class="spec">
	{#each principles as principle (principle.term)}
		<div class="entry">
			<dt>{principle.term}</dt>
			<dd class="measure">{principle.body}</dd>
		</div>
	{/each}
</dl>
<p class="muted measure measured">{measured}</p>

<style>
	h2 {
		font-stretch: var(--wdth-heading);
		font-weight: 700;
		font-size: var(--text-xl);
		line-height: var(--leading-heading);
		letter-spacing: var(--tracking-heading);
	}

	.intro {
		margin-top: var(--space-4);
	}

	.spec {
		margin: var(--space-6) 0 0 0;
		border-top: var(--rule) solid currentColor;
	}

	.entry {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-2) var(--space-8);
		padding: var(--space-4) 0;
		border-bottom: var(--rule-thin) solid currentColor;
	}

	.entry:last-child {
		border-bottom-width: var(--rule);
	}

	dt {
		font-weight: 700;
		font-size: var(--text-md);
		line-height: 1.2;
	}

	dd {
		margin: 0;
		font-size: 1rem;
		line-height: var(--leading-small);
	}

	.measured {
		margin-top: var(--space-5);
		font-size: var(--text-sm);
	}

	@media (min-width: 768px) {
		h2 {
			font-size: var(--text-2xl);
		}

		.intro {
			margin-top: var(--space-5);
		}

		.spec {
			margin-top: var(--space-8);
		}

		.entry {
			grid-template-columns: 340px minmax(0, 1fr);
			padding: var(--space-5) 0;
		}

		dt {
			font-size: var(--text-lg);
		}

		dd {
			font-size: var(--text-base);
			line-height: var(--leading-body);
		}

		.measured {
			margin-top: var(--space-6);
		}
	}
</style>
