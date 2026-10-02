<script lang="ts">
	/** A form-level message (DESIGN.md section 5): a 2px box, bold first line. */
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		id?: string;
		children?: Snippet;
	}

	let { title, id, children }: Props = $props();
</script>

<div class="notice" {id}>
	<p class="title">{title}</p>
	{#if children}
		<div class="body">{@render children()}</div>
	{/if}
</div>

<style>
	.notice {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		border: var(--rule) solid var(--ink);
	}

	.title {
		font-weight: 700;
		font-size: 1rem;
		line-height: 1.4;
	}

	.body {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-3);
		font-size: 1rem;
		line-height: var(--leading-small);
	}
</style>
