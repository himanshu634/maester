<script lang="ts">
	/** DESIGN.md form field: label above, 44px input, the fix below when it is wrong. */
	import type { HTMLInputAttributes } from 'svelte/elements';

	interface Props {
		id: string;
		label: string;
		type?: 'text' | 'email';
		autocomplete: HTMLInputAttributes['autocomplete'];
		value: string;
		error?: string | null;
		hint?: string;
	}

	let {
		id,
		label,
		type = 'text',
		autocomplete,
		value = $bindable(),
		error,
		hint
	}: Props = $props();
	const describedby = $derived(
		[hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined
	);
</script>

<div class="field">
	<label for={id}>{label}</label>
	{#if hint}<p class="hint" id="{id}-hint">{hint}</p>{/if}
	<input
		{id}
		name={id}
		{type}
		{autocomplete}
		bind:value
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={describedby}
		class={{ invalid: !!error }}
	/>
	{#if error}<p class="error" id="{id}-error">{error}</p>{/if}
</div>

<style>
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

	.hint {
		color: var(--ink-muted);
		font-size: var(--text-sm);
		line-height: var(--leading-small);
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

	input.invalid {
		border-width: 3px;
	}

	.error {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
		font-weight: 700;
	}
</style>
