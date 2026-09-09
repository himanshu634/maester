<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Link } from '$lib/content';

	interface Props {
		title: string;
		lede: string;
		primary: Link;
		secondary: Link;
	}

	let { title, lede, primary, secondary }: Props = $props();
</script>

<div class="hero">
	<h1 id="hero-heading">{title}</h1>
	<p class="lede">{lede}</p>
	<div class="actions">
		<a class="button outline" href={resolve(primary.href)}>{primary.label}</a>
		<a href={resolve(secondary.href)}>{secondary.label}</a>
	</div>
</div>

<style>
	.hero {
		padding-bottom: var(--space-8);
	}

	h1 {
		font-stretch: var(--wdth-wide);
		font-weight: 800;
		font-size: var(--text-display);
		line-height: var(--leading-display);
		letter-spacing: var(--tracking-display);
		max-width: 14ch;
		text-wrap: balance;
	}

	.lede {
		margin-top: var(--space-6);
		max-width: 62ch;
		font-size: var(--text-md);
		line-height: 1.45;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-4) var(--space-7);
		margin-top: var(--space-8);
	}

	@media (min-width: 768px) {
		.lede {
			font-size: var(--text-lg);
			margin-top: var(--space-8);
		}
	}
</style>
