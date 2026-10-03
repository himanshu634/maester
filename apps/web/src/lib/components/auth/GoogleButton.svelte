<script lang="ts">
	/**
	 * Google's sign-in button (DESIGN.md section 5): the square 2px button in Archivo,
	 * with Google's four-colour G on a paper chip, the one place --brand-google-* is used.
	 * Filled when it is the screen's primary action.
	 */
	interface Props {
		label: string;
		primary?: boolean;
		busy?: boolean;
		/** Another action on the page is running: disabled, with the label unchanged. */
		disabled?: boolean;
		busyLabel?: string;
		describedby?: string;
		onclick: () => void;
		/** The button itself, so a page can return focus to it after a failed request. */
		element?: HTMLButtonElement;
	}

	let {
		label,
		primary = false,
		busy = false,
		disabled = false,
		busyLabel,
		describedby,
		onclick,
		element = $bindable()
	}: Props = $props();
</script>

<button
	bind:this={element}
	class={['button', 'google', { outline: !primary }]}
	type="button"
	disabled={busy || disabled}
	aria-describedby={describedby}
	{onclick}
>
	<span class="chip" aria-hidden="true">
		<svg width="18" height="18" viewBox="0 0 48 48" focusable="false">
			<path
				class="red"
				d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
			/>
			<path
				class="blue"
				d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
			/>
			<path
				class="yellow"
				d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
			/>
			<path
				class="green"
				d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
			/>
		</svg>
	</span>
	<span class="label">{busy && busyLabel ? busyLabel : label}</span>
</button>

<style>
	.google {
		width: 100%;
		min-height: 48px;
		justify-content: flex-start;
		gap: var(--space-3);
		padding: 0 var(--space-5) 0 var(--space-2);
	}

	.chip {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		flex-shrink: 0;
		background: var(--paper);
	}

	.google:disabled .chip {
		opacity: 0.6;
	}

	.red {
		fill: var(--brand-google-red);
	}
	.blue {
		fill: var(--brand-google-blue);
	}
	.yellow {
		fill: var(--brand-google-yellow);
	}
	.green {
		fill: var(--brand-google-green);
	}
</style>
