<!--
	One accordion item: an h3 holding a real button with the item's name, a one-line summary, its
	state in words and + or − as decoration (aria-expanded carries the state). Several items can
	be open at once; it shows and hides at once, with no motion, and focus stays on the button.
	On a phone the state takes the summary's place.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		id: string;
		title: string;
		summary: string;
		state: string;
		/** Bold state: the item needs you. */
		stateStrong?: boolean;
		open?: boolean;
		/** The header button, so the page can return focus to it after a save. */
		button?: HTMLButtonElement;
		children: Snippet;
	}

	let {
		id,
		title,
		summary,
		state,
		stateStrong = false,
		open = $bindable(false),
		button = $bindable(),
		children
	}: Props = $props();
</script>

<section class="item">
	<h3>
		<button
			type="button"
			bind:this={button}
			aria-expanded={open}
			aria-controls="{id}-panel"
			onclick={() => (open = !open)}
		>
			<span class="text">
				<span class="title">{title}</span>
				<span class="summary muted">{summary}</span>
				<span class={['state-under', 'muted', { strong: stateStrong }]}>{state}</span>
			</span>
			<span class={['state', { strong: stateStrong }]}>{state}</span>
			<span class="sign" aria-hidden="true">{open ? '−' : '+'}</span>
		</button>
	</h3>
	<div class="panel" id="{id}-panel" hidden={!open}>
		{@render children()}
	</div>
</section>

<style>
	.item {
		border-top: var(--rule) solid var(--ink);
	}

	h3 {
		margin: 0;
	}

	button {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 24px;
		gap: var(--space-2);
		align-items: center;
		width: 100%;
		min-height: 64px;
		padding: var(--space-3) 0;
		background: transparent;
		border: 0;
		text-align: left;
		font: inherit;
		color: var(--ink);
		cursor: pointer;
	}

	button:hover .title {
		text-decoration: underline;
		text-underline-offset: 3px;
		text-decoration-thickness: 1.5px;
	}

	.text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.title {
		font-stretch: var(--wdth-heading);
		font-weight: 700;
		font-size: var(--text-lg);
		line-height: 1.2;
	}

	.summary,
	.state-under {
		font-size: var(--text-sm);
		font-weight: 400;
		line-height: var(--leading-small);
	}

	.summary,
	.state {
		display: none;
	}

	.strong {
		font-weight: 700;
		color: var(--ink);
	}

	.sign {
		font-size: var(--text-xl);
		font-weight: 700;
		line-height: 1;
		text-align: center;
	}

	.panel {
		padding: var(--space-2) 0 var(--space-8);
	}

	@media (min-width: 768px) {
		button {
			grid-template-columns: minmax(0, 1fr) auto 24px;
			gap: var(--space-6);
		}

		.summary,
		.state {
			display: block;
		}

		.state-under {
			display: none;
		}

		.state {
			font-size: 1rem;
		}
	}
</style>
