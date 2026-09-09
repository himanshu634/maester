<script lang="ts">
	interface Props {
		headingId: string;
		heading: string;
		noise: readonly string[];
		body: string;
	}

	let { headingId, heading, noise, body }: Props = $props();
</script>

<h2 id={headingId}>{heading}</h2>
<ul class="noise">
	{#each noise as item (item)}
		<li>{item}</li>
	{/each}
</ul>
<p class="measure body">{body}</p>

<style>
	h2 {
		font-stretch: var(--wdth-heading);
		font-weight: 700;
		font-size: var(--text-xl);
		line-height: var(--leading-heading);
		letter-spacing: var(--tracking-heading);
	}

	.noise {
		list-style: none;
		padding: 0;
		margin-top: var(--space-6);
		border-top: var(--rule) solid var(--ink);
	}

	.noise li {
		padding: var(--space-3) 0;
		border-bottom: var(--rule-thin) solid var(--ink-muted);
		font-size: var(--text-md);
		font-weight: 700;
		line-height: 1.3;
		max-width: 40ch;
		text-wrap: pretty;
	}

	.noise li:last-child {
		border-bottom: var(--rule) solid var(--ink);
	}

	.body {
		margin-top: var(--space-6);
	}

	@media (min-width: 768px) {
		h2 {
			font-size: var(--text-2xl);
		}

		.noise {
			margin-top: var(--space-8);
		}

		.noise li {
			font-size: var(--text-lg);
			padding: var(--space-4) 0;
		}
	}
</style>
