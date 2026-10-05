<!--
	A wait with nothing to draw yet: what is being waited for, in words, and the ruler.
	Nothing shows for the first 300 ms, so a quick load never flashes. After 10 s it says
	the wait is longer than usual and, when the caller can retry, offers a Try again button.
	The status region is always there, so the words are announced once when they appear.
-->
<script lang="ts">
	import { browserEnv, watchPhase, type WaitPhase } from '$lib/loading/loading';
	import { loadingContent } from '$lib/content/loading';
	import Ruler from './Ruler.svelte';

	interface Props {
		/** What is being waited for, as a sentence: "Checking your session." */
		label: string;
		/** Starts the work again. Without it a slow wait only says so. */
		onretry?: () => void;
	}

	let { label, onretry }: Props = $props();

	let phase = $state<WaitPhase>('quiet');

	$effect(() => watchPhase((next) => (phase = next), browserEnv));
</script>

<div class="loader" role="status">
	{#if phase !== 'quiet'}
		<p>{label}</p>
		<Ruler />
		{#if phase === 'slow'}
			<p class="muted">{loadingContent.slow}</p>
			{#if onretry}
				<button type="button" class="button outline" onclick={onretry}>
					{loadingContent.retry}
				</button>
			{/if}
		{/if}
	{/if}
</div>

<style>
	.loader {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-3);
		max-width: 20rem;
	}

	.loader > :global(.ruler) {
		align-self: stretch;
	}

	p {
		margin: 0;
	}
</style>
