<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { content } from '$lib/content';
	import { safeNext } from '$lib/session';
	import Masthead from '$lib/components/Masthead.svelte';
	import LoginIllustration from '$lib/components/LoginIllustration.svelte';

	let next = $state('/terminal');
	let email = $state('');
	let password = $state('');
	let status = $state<string | null>(null);

	onMount(() => {
		next = safeNext(page.url.searchParams.get('next'));
	});

	function submit(event: SubmitEvent) {
		event.preventDefault();
		// The hosted API (F01) is not built. Say so instead of pretending.
		status = content.login.notConnected;
		password = '';
	}
</script>

<svelte:head>
	<title>{content.login.heading}. Maester</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
	<Masthead {...content.masthead} />

	<main id="main" class="login">
		<div class="panel">
			<h1>{content.login.heading}</h1>
			<p class="measure lede">{content.login.lede}</p>

			<form onsubmit={submit} novalidate>
				<input type="hidden" name="next" value={next} />
				<div class="field">
					<label for="email">Email</label>
					<input id="email" name="email" type="email" autocomplete="email" bind:value={email} />
				</div>
				<div class="field">
					<label for="password">Password</label>
					<input
						id="password"
						name="password"
						type="password"
						autocomplete="current-password"
						bind:value={password}
					/>
				</div>
				<button class="button" type="submit">Sign in</button>
			</form>

			<p class="status" role="status" aria-live="polite">{status ?? ''}</p>
			<p class="muted small">
				Sending you to <code>{next}</code> after sign-in.
				<a href={resolve('/')}>Back to the index page</a>.
			</p>
		</div>
		<figure class="scene">
			<LoginIllustration />
		</figure>
	</main>
</div>

<style>
	/* Masthead, then everything left of the screen. A grid, because its 1fr row respects min-height. */
	.page {
		min-height: 100dvh;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
	}

	.login {
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

	h1 {
		font-stretch: var(--wdth-wide);
		font-weight: 800;
		font-size: var(--text-xl);
		line-height: var(--leading-heading);
		letter-spacing: var(--tracking-heading);
	}

	form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		align-items: flex-start;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		width: 100%;
	}

	label {
		font-weight: 700;
		font-size: var(--text-sm);
	}

	input {
		width: 100%;
		min-height: var(--target);
		padding: 0 var(--space-3);
		border: var(--rule) solid var(--ink);
		background: var(--paper);
		color: var(--ink);
		font: inherit;
		font-size: 1rem;
		border-radius: var(--radius);
	}

	.status {
		font-size: var(--text-sm);
		min-height: 1.5em;
	}

	.small {
		font-size: var(--text-sm);
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

	code {
		font-family: inherit;
		font-weight: 700;
	}

	@media (min-width: 768px) {
		.panel {
			padding: var(--space-8);
		}

		h1 {
			font-size: var(--text-2xl);
		}
	}

	@media (min-width: 1024px) {
		.login {
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
