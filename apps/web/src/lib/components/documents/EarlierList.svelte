<!--
	The workspace's other documents, newest first: each name opens its slip, then what it is and
	where it stands, in words. Rows are divided by hairlines and the list is closed by a 2px rule.
-->
<script lang="ts">
	import { documentsContent as copy } from '$lib/content/documents';
	import { DOCUMENT_PAGE } from '$lib/documents/client';
	import { stateLabel, whatItIs } from '$lib/documents/intake';
	import type { DocumentRecord } from '$lib/documents/types';

	interface Props {
		docs: DocumentRecord[];
		/** The API has more than the first page. */
		more: boolean;
		/** The document whose bytes this page is sending. */
		uploadingId?: string | null;
		onopen: (id: string) => void;
	}

	let { docs, more, uploadingId = null, onopen }: Props = $props();

	const id = $props.id();
</script>

<section class="earlier" aria-labelledby="{id}-heading">
	<h2 id="{id}-heading">{copy.earlier.heading}</h2>
	{#if docs.length === 0}
		<p class="empty">{copy.earlier.empty}</p>
	{:else}
		<ul>
			{#each docs as doc (doc.id)}
				<li>
					<button class="name" type="button" onclick={() => onopen(doc.id)}>
						{doc.originalName}
					</button>
					<span class="kind">{whatItIs(doc.classification)}</span>
					<span class="state">{stateLabel(doc, { uploading: doc.id === uploadingId })}</span>
				</li>
			{/each}
		</ul>
		{#if more}
			<p class="more muted">{copy.earlier.more(DOCUMENT_PAGE)}</p>
		{/if}
	{/if}
</section>

<style>
	.earlier {
		min-width: 0;
		container-type: inline-size;
	}

	h2 {
		font-stretch: var(--wdth-heading);
		font-weight: 700;
		font-size: var(--text-lg);
		line-height: var(--leading-heading);
		letter-spacing: var(--tracking-heading);
		margin-bottom: var(--space-2);
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		border-bottom: var(--rule) solid var(--ink);
	}

	li {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0 var(--space-4);
		padding: 0 0 var(--space-3);
		border-top: var(--rule-thin) solid var(--ink-muted);
		font-size: 1rem;
		line-height: var(--leading-small);
	}

	.name {
		justify-self: start;
		min-height: var(--target);
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		font-weight: 700;
		text-align: left;
		overflow-wrap: anywhere;
		text-decoration: underline;
		text-underline-offset: 3px;
		text-decoration-thickness: 1.5px;
		cursor: pointer;
	}

	.name:hover {
		background: var(--ink);
		color: var(--paper);
		text-decoration: none;
	}

	.kind,
	.state {
		min-width: 0;
	}

	.state {
		color: var(--ink-muted);
	}

	.empty {
		padding: var(--space-3) 0;
		border-top: var(--rule-thin) solid var(--ink-muted);
		border-bottom: var(--rule) solid var(--ink);
		font-size: 1rem;
	}

	.more {
		margin-top: var(--space-2);
		font-size: var(--text-sm);
	}

	@container (min-width: 36rem) {
		li {
			grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr);
			align-items: center;
			padding: var(--space-1) 0;
		}
	}
</style>
