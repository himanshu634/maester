<!--
	One track of a filing: Numbers or Text. A label column and two lines of words. The first line is
	bold only when the track needs the investor or stopped (Decision 18); the second is muted. In the
	opened filing a working track is an ink block (`ink`), and its children (a "Try again") sit under
	the words.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { TrackWords } from '$lib/documents/tracks';

	interface Props {
		label: string;
		words: TrackWords;
		/** Draw a working track as an ink block (the opened filing only). */
		ink?: boolean;
		children?: Snippet;
	}

	let { label, words, ink = false, children }: Props = $props();

	let block = $derived(ink && words.state === 'now');
	let loud = $derived(words.state === 'needs-you' || words.state === 'stopped');
</script>

<div class={['track', { inverted: block }]}>
	<span class="label">{label}</span>
	<div class="body">
		<p class={['first', { loud }]}>{words.first}</p>
		{#if words.second}<p class="second">{words.second}</p>{/if}
		{#if children}{@render children()}{/if}
	</div>
</div>

<style>
	.track {
		display: grid;
		grid-template-columns: 76px minmax(0, 1fr);
		gap: var(--space-2);
		align-items: baseline;
		min-width: 0;
	}

	.track.inverted {
		padding: var(--space-2) var(--space-3);
		background: var(--ink);
		color: var(--paper);
	}

	.label {
		font-size: var(--text-sm);
		font-weight: 700;
		line-height: var(--leading-small);
	}

	.body {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-1);
		min-width: 0;
	}

	.first {
		font-size: 1rem;
		font-weight: 400;
		line-height: var(--leading-small);
		overflow-wrap: anywhere;
	}

	.first.loud {
		font-weight: 700;
	}

	.second {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
		color: var(--ink-muted);
		overflow-wrap: anywhere;
	}

	.inverted .second {
		color: var(--paper-muted);
	}
</style>
