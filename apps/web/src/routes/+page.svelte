<script lang="ts">
	import { resolve } from '$app/paths';
	import { content } from '$lib/content';
	import Register from '$lib/components/Register.svelte';
	import Masthead from '$lib/components/Masthead.svelte';
	import Hero from '$lib/components/Hero.svelte';
	import Problem from '$lib/components/Problem.svelte';
	import EvidenceTrace from '$lib/components/EvidenceTrace.svelte';
	import Ledger from '$lib/components/Ledger.svelte';
	import Comparison from '$lib/components/Comparison.svelte';
	import AccuracySpec from '$lib/components/AccuracySpec.svelte';
	import StatusBoard from '$lib/components/StatusBoard.svelte';
	import SiteFooter from '$lib/components/SiteFooter.svelte';
</script>

<svelte:head>
	<title>Maester</title>
	<meta
		name="description"
		content="Maester watches the filings, prices, dividends and policy changes behind every company you own, and tells you when a decision is due. Every suggestion comes with its evidence."
	/>
</svelte:head>

<Masthead {...content.masthead} />

<main id="main">
	<Register label={content.index.title} headingId="hero-heading">
		{#snippet rail()}
			<nav aria-label={content.index.title} class="index">
				<span class="muted">{content.index.title}</span>
				{#each content.index.links as link (link.href)}
					<a href={resolve(link.href)}>{link.label}</a>
				{/each}
			</nav>
		{/snippet}
		<Hero {...content.hero} />
		<EvidenceTrace {...content.suggestion} />
	</Register>

	<Register id="problem" label="The problem" headingId="problem-heading">
		<Problem headingId="problem-heading" {...content.problem} />
	</Register>

	<Register id="features" label="What it watches" headingId="features-heading">
		<Ledger headingId="features-heading" {...content.features} />
	</Register>

	<Register id="how" label="How it works" headingId="how-heading">
		<Ledger headingId="how-heading" numbered {...content.how} />
	</Register>

	<Register id="week" label="Your week" headingId="week-heading">
		<Comparison headingId="week-heading" {...content.week} />
	</Register>

	<Register id="trust" label="Why trust it" headingId="trust-heading" inverted>
		<AccuracySpec headingId="trust-heading" {...content.trust} />
	</Register>

	<Register id="status" label="Where we are" headingId="status-heading">
		<StatusBoard headingId="status-heading" {...content.status} />
	</Register>
</main>

<Register label="Maester" headingId="footer" as="footer">
	<SiteFooter wordmark={content.masthead.wordmark} {...content.footer} />
</Register>

<style>
	.index {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-5);
	}

	@media (min-width: 1024px) {
		.index {
			flex-direction: column;
			gap: var(--space-2);
		}
	}
</style>
