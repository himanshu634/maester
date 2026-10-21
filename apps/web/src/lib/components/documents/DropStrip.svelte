<!--
	Where files come in: a 2px dashed box (the dashed outline already marks "not there yet" on
	the sector bars) saying "Drop PDFs or XBRL files here", or "Choose files" and "Choose a folder", which open
	the system pickers. Dragging is never the only way. The limit is stated before anything is
	chosen. While a batch is checked and sent, one line in the box says how far it has got, with
	the ruler; the page announces the start and the end, so the line itself is not live. Files
	that were not added are named in one Notice per batch, each with why.
-->
<script lang="ts">
	import type { Attachment } from 'svelte/attachments';
	import { resolve } from '$app/paths';
	import { signInAgainHref } from '$lib/errors/errors';
	import { documentsContent as copy } from '$lib/content/documents';
	import {
		pickedFrom,
		refusedTitle,
		sentLine,
		walkEntries,
		type DropEntry,
		type Outcome,
		type Picked,
		type Refusal
	} from '$lib/documents/batch';
	import Loader from '$lib/components/loading/Loader.svelte';
	import Notice from '$lib/components/auth/Notice.svelte';

	interface Props {
		/** Called with the files the investor chose or dropped, folders walked. */
		onfiles: (picked: Picked[]) => void;
		/** The line in the box while a batch is checked or sent. */
		busy?: string | null;
		/** How the last batch went. */
		outcome?: Outcome | null;
		/** No file can be taken yet; `waitingNote` is the id of the visible line that says why. */
		waitingNote?: string;
	}

	let { onfiles, busy = null, outcome = null, waitingNote }: Props = $props();

	const id = $props.id();
	const signInHref = resolve(signInAgainHref('/terminal/documents'));
	let filesInput = $state<HTMLInputElement>();
	let folderInput = $state<HTMLInputElement>();
	let over = $state(false);

	const hasFiles = (event: DragEvent) => !!event.dataTransfer?.types.includes('Files');
	let disabled = $derived(!!busy || !!waitingNote);
	let describedBy = $derived([waitingNote, `${id}-note`].filter(Boolean).join(' '));
	let sent = $derived(outcome ? sentLine(outcome) : null);
	let refused = $derived(
		outcome && (outcome.refused.length > 0 || outcome.unsent > 0) ? outcome : null
	);

	/**
	 * Drag and drop on the box, added as listeners rather than attributes: the box is not a
	 * control (the buttons are), and a drop is a shortcut for choosing files.
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
			if (disabled || !event.dataTransfer) return;
			// The drop's items are gone once this handler returns, so take them now. A folder is
			// an entry to walk; in `files` it is a single empty file.
			const files = Array.from(event.dataTransfer.files);
			const entries = Array.from(event.dataTransfer.items)
				.map((item) => (item.kind === 'file' ? item.webkitGetAsEntry() : null))
				.filter((entry) => entry !== null) as DropEntry[];
			if (entries.length === 0) onfiles(pickedFrom(files));
			else walkEntries(entries).then(onfiles, () => onfiles(pickedFrom(files)));
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
		const files = Array.from(event.currentTarget.files ?? []);
		// Cleared so choosing the same files again still counts as a choice.
		event.currentTarget.value = '';
		if (files.length > 0) onfiles(pickedFrom(files));
	}

	/** Files dropped anywhere else would open in the tab and leave the page. */
	function guard(event: DragEvent) {
		if (hasFiles(event)) event.preventDefault();
	}
</script>

<svelte:window ondragover={guard} ondrop={guard} />

{#snippet list(items: Refusal[])}
	<ul>
		{#each items as refusal, index (index)}
			<li><span class="name">{refusal.name}</span> {refusal.reason}</li>
		{/each}
	</ul>
{/snippet}

<div class="strip-wrap">
	<div class={['strip', { over }]} {@attach dropTarget}>
		{#if busy}
			<Loader label={busy} live={false} />
		{:else}
			<p class="title">{copy.drop.title}</p>
			<span class="or">{copy.drop.or}</span>
			<div class="choose">
				<button
					class="button outline"
					type="button"
					{disabled}
					aria-describedby={describedBy}
					onclick={() => filesInput?.click()}>{copy.drop.chooseFiles}</button
				>
				<button
					class="button outline"
					type="button"
					{disabled}
					aria-describedby={describedBy}
					onclick={() => folderInput?.click()}>{copy.drop.chooseFolder}</button
				>
			</div>
			<p class="note" id="{id}-note">{copy.drop.note}</p>
			{#if sent}
				<p class="sent">{sent}</p>
			{/if}
		{/if}
		<input
			bind:this={filesInput}
			class="visually-hidden"
			type="file"
			multiple
			accept="application/pdf,.pdf,.xml,application/xml,text/xml"
			tabindex="-1"
			aria-hidden="true"
			onchange={chosen}
		/>
		<input
			bind:this={folderInput}
			class="visually-hidden"
			type="file"
			webkitdirectory
			tabindex="-1"
			aria-hidden="true"
			onchange={chosen}
		/>
	</div>
	{#if refused && !busy}
		<!-- A note, not an alert: the page's end-of-batch line already says how many. -->
		<Notice title={refusedTitle(refused)} role="note">
			{#if refused.refused.length > 8}
				<!-- A long list scrolls in its own labelled region, which must take focus (WCAG 2.1.1). -->
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<div
					class="refused long"
					role="region"
					aria-label={copy.drop.refusedListLabel}
					tabindex="0"
				>
					{@render list(refused.refused)}
				</div>
			{:else if refused.refused.length > 0}
				<div class="refused">{@render list(refused.refused)}</div>
			{/if}
			{#if refused.stopped}
				<p>{copy.drop.stopped[refused.stopped](refused.unsent)}</p>
			{/if}
			{#if refused.stopped === 'signed-out'}
				<a href={signInHref}>{copy.drop.signIn}</a>
			{:else}
				<button class="button outline" type="button" onclick={() => filesInput?.click()}>
					{copy.drop.chooseAgain}
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

	/* Files held over the box: a hard inversion, as hover is everywhere else. */
	.strip.over {
		border-style: solid;
		background: var(--ink);
		color: var(--paper);
	}

	.title {
		font-weight: 700;
	}

	.choose {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}

	.note,
	.sent {
		flex-basis: 100%;
		font-size: var(--text-sm);
		line-height: var(--leading-small);
	}

	.note {
		color: var(--ink-muted);
	}

	.over .note {
		color: var(--paper-muted);
	}

	.strip > :global(.loader) {
		flex: 1;
	}

	.refused.long {
		max-height: 16rem;
		overflow-y: auto;
	}

	.refused ul {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.refused .name {
		font-weight: 700;
		overflow-wrap: anywhere;
	}

	@media (min-width: 1024px) {
		.note {
			flex-basis: auto;
			margin-left: auto;
			max-width: 34rem;
		}
	}
</style>
