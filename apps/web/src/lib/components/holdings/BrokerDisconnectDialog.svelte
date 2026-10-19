<!--
	Asks before a broker is disconnected: a native modal dialog with "Disconnect" and "Keep it".
	Escape keeps it.
-->
<script lang="ts">
	import { holdingsContent as copy } from '$lib/content/holdings';

	interface Props {
		open: boolean;
		name: string;
		/** What disconnecting forgets: the key and secret, or (for a Settings connection) only the account here. */
		detail: string;
		busy?: boolean;
		onconfirm: () => void;
		onclose: () => void;
	}

	let { open, name, detail, busy = false, onconfirm, onclose }: Props = $props();

	const id = $props.id();
	let dialog = $state<HTMLDialogElement>();

	// The dialog element is the one place a modal opens; follow `open` there.
	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	});
</script>

<dialog bind:this={dialog} aria-labelledby="{id}-title" aria-describedby="{id}-detail" {onclose}>
	<p class="title" id="{id}-title">{copy.dialog.title(name)}</p>
	<p id="{id}-detail">{detail}</p>
	<div class="actions">
		<button type="button" class="button" disabled={busy} onclick={onconfirm}
			>{copy.dialog.confirm}</button
		>
		<button type="button" class="button outline" onclick={onclose}>{copy.dialog.keep}</button>
	</div>
</dialog>

<style>
	dialog {
		max-width: min(30rem, calc(100vw - 2 * var(--gutter)));
		padding: var(--space-6);
		border: var(--rule) solid var(--ink);
		background: var(--paper);
		color: var(--ink);
	}

	dialog::backdrop {
		background: var(--paper-muted);
	}

	.title {
		font-weight: 700;
		margin-bottom: var(--space-2);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		margin-top: var(--space-5);
	}
</style>
