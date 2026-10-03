<script lang="ts">
	/** A password field with a real Show button (44px, aria-pressed) attached to its right. */
	interface Props {
		id: string;
		label: string;
		autocomplete: 'current-password' | 'new-password';
		value: string;
		error?: string | null;
		hint?: string;
	}

	let { id, label, autocomplete, value = $bindable(), error, hint }: Props = $props();
	let shown = $state(false);
	const describedby = $derived(
		[hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined
	);
</script>

<div class="field">
	<label for={id}>{label}</label>
	{#if hint}<p class="hint" id="{id}-hint">{hint}</p>{/if}
	<div class="row">
		<input
			{id}
			name={id}
			type={shown ? 'text' : 'password'}
			{autocomplete}
			bind:value
			aria-invalid={error ? 'true' : undefined}
			aria-describedby={describedby}
			class={{ invalid: !!error }}
		/>
		<button
			class="show"
			type="button"
			aria-pressed={shown}
			aria-controls={id}
			onclick={() => (shown = !shown)}
			>{shown ? 'Hide' : 'Show'}<span class="visually-hidden"> {label.toLowerCase()}</span></button
		>
	</div>
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

	.row {
		display: flex;
		align-items: stretch;
	}

	input {
		flex: 1;
		min-width: 0;
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

	.show {
		min-height: var(--target);
		min-width: var(--target);
		padding: 0 var(--space-4);
		border: var(--rule) solid var(--ink);
		border-left: 0;
		background: transparent;
		color: var(--ink);
		font: inherit;
		font-size: 1rem;
		font-weight: 700;
		cursor: pointer;
	}

	.show:hover {
		background: var(--ink);
		color: var(--paper);
	}

	.error {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
		font-weight: 700;
	}
</style>
