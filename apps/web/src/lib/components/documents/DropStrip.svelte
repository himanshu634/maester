<!--
	Where a file comes in: a 2px dashed box (the dashed outline already marks "not there yet" on
	the sector bars) saying "Drop a PDF here", or "Choose a file", which opens the system file
	picker. Dragging is never the only way. The limit is stated before a file is chosen. While a
	file is being sent it says so with the loader; a file that cannot go says why below the box.
-->
<script lang="ts">
	import type { Attachment } from 'svelte/attachments';
	import { resolve } from '$app/paths';
	import { signInAgainHref } from '$lib/errors/errors';
	import { documentsContent as copy } from '$lib/content/documents';
	import Loader from '$lib/components/loading/Loader.svelte';
	import Notice from '$lib/components/auth/Notice.svelte';

	interface Props {
		/** Called with the file the investor chose or dropped. */
		onfile: (file: File) => void;
		/** The name of the file being sent, while it is. */
		uploading?: string | null;
		/** No file can be taken yet; `waitingNote` is the id of the visible line that says why. */
		waitingNote?: string;
		/** What went wrong with the last file, and the way out. */
		problem?: { message: string; signIn?: boolean } | null;
	}

	let { onfile, uploading = null, waitingNote, problem = null }: Props = $props();

	const id = $props.id();
	const signInHref = resolve(signInAgainHref('/terminal/documents'));
	let input = $state<HTMLInputElement>();
	let over = $state(false);

	const hasFiles = (event: DragEvent) => !!event.dataTransfer?.types.includes('Files');
	let disabled = $derived(!!uploading || !!waitingNote);

	/**
	 * Drag and drop on the box, added as listeners rather than attributes: the box is not a
	 * control (the button is), and a drop is a shortcut for choosing a file.
	 */
	const dropTarget: Attachment<HTMLElement> = (node) => {
		function dragover(event: DragEvent) {
			if (!hasFiles(event)) return;
			event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
			over = !disabled;
		}
		function dragleave(event: DragEvent) {
			if (!node.contains(event.relatedTarget as Node | null)) over = false;
		}
		function drop(event: DragEvent) {
			if (!hasFiles(event)) return;
			event.preventDefault();
			over = false;
			const file = event.dataTransfer?.files[0];
			if (file && !disabled) onfile(file);
		}
		node.addEventListener('dragover', dragover);
		node.addEventListener('dragleave', dragleave);
		node.addEventListener('drop', drop);
		return () => {
			node.removeEventListener('dragover', dragover);
			node.removeEventListener('dragleave', dragleave);
			node.removeEventListener('drop', drop);
		};
	};

	function chosen(event: Event & { currentTarget: HTMLInputElement }) {
		const file = event.currentTarget.files?.[0];
		// Cleared so choosing the same file again still counts as a choice.
		event.currentTarget.value = '';
		if (file) onfile(file);
	}

	/** A file dropped anywhere else would open in the tab and leave the page. */
	function guard(event: DragEvent) {
		if (hasFiles(event)) event.preventDefault();
	}
</script>

<svelte:window ondragover={guard} ondrop={guard} />

<div class="strip-wrap">
	<div class={['strip', { over }]} {@attach dropTarget}>
		{#if uploading}
			<Loader label={copy.drop.uploading(uploading)} />
		{:else}
			<p class="title">{copy.drop.title}</p>
			<span class="or">{copy.drop.or}</span>
			<button
				class="button outline"
				type="button"
				{disabled}
				aria-describedby={[waitingNote, `${id}-note`].filter(Boolean).join(' ')}
				onclick={() => input?.click()}>{copy.drop.choose}</button
			>
			<p class="note" id="{id}-note">{copy.drop.note}</p>
		{/if}
		<input
			bind:this={input}
			class="visually-hidden"
			type="file"
			accept="application/pdf,.pdf"
			tabindex="-1"
			aria-hidden="true"
			onchange={chosen}
		/>
	</div>
	{#if problem}
		<Notice title={problem.message}>
			{#if problem.signIn}
				<a href={signInHref}>{copy.uploadFailed.signIn}</a>
			{:else}
				<button class="button outline" type="button" onclick={() => input?.click()}>
					{copy.precheck.chooseAnother}
				</button>
			{/if}
		</Notice>
	{/if}
</div>

<style>
	.strip-wrap {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.strip {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3) var(--space-4);
		min-height: calc(var(--target) + 2 * var(--space-4) + 2 * var(--rule));
		padding: var(--space-4) var(--space-5);
		border: var(--rule) dashed var(--ink);
	}

	/* A file held over the box: a hard inversion, as hover is everywhere else. */
	.strip.over {
		border-style: solid;
		background: var(--ink);
		color: var(--paper);
	}

	.title {
		font-weight: 700;
	}

	.note {
		flex-basis: 100%;
		font-size: var(--text-sm);
		line-height: var(--leading-small);
		color: var(--ink-muted);
	}

	.over .note {
		color: var(--paper-muted);
	}

	.strip > :global(.loader) {
		flex: 1;
	}

	@media (min-width: 1024px) {
		.note {
			flex-basis: auto;
			margin-left: auto;
			max-width: 34rem;
		}
	}
</style>
