<!--
	The Documents page (direction B, the intake desk). Add a filing; Maester works out what it is
	and carries on reading without waiting. The slip shows the newest document that is not settled
	(or the one opened from Earlier), where it stands and what it was read as. A new or unclear
	company holds the document until the investor confirms it. While Maester is working, the slip
	asks the API again every 2 seconds and says each change once, politely; it stops when the work
	stops, while the tab is hidden and when the page is left. Leaving never cancels anything.
-->
<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { documentsContent as copy } from '$lib/content/documents';
	import { documentsApi, readMe, type DocumentsApi, type Fetcher } from '$lib/documents/client';
	import {
		changeFailure,
		checkFile,
		isLive,
		pickSlip,
		POLL_MS,
		stateLabel,
		uploadFailure
	} from '$lib/documents/intake';
	import type { Company, DocumentClassification, DocumentRecord } from '$lib/documents/types';
	import SectionIssue from '$lib/components/errors/SectionIssue.svelte';
	import Hatch from '$lib/components/loading/Hatch.svelte';
	import DropStrip from './DropStrip.svelte';
	import EarlierList from './EarlierList.svelte';
	import Slip, { type Change } from './Slip.svelte';

	const id = $props.id();
	const fetcher: Fetcher = (url, init) => fetch(url, init);

	let load = $state<'loading' | 'failed' | 'no-workspace' | 'ready'>('loading');
	let api = $state.raw<DocumentsApi | null>(null);
	let docs = $state.raw<DocumentRecord[]>([]);
	let more = $state(false);
	let companies = $state.raw<Company[]>([]);
	/** The document the slip shows. Pinned, so a slip never jumps away when its work finishes. */
	let opened = $state<string | null>(null);
	let answers = $state.raw<DocumentClassification | null>(null);
	let uploadingId = $state<string | null>(null);
	let uploadingName = $state<string | null>(null);
	let problem = $state<{ message: string; signIn?: boolean } | null>(null);
	let message = $state<string | null>(null);
	let announcement = $state('');
	let hidden = $state(false);
	let pollFailures = $state(0);
	let slipHeading = $state<HTMLHeadingElement>();

	const newestFirst = (a: DocumentRecord, b: DocumentRecord) =>
		Date.parse(b.createdAt) - Date.parse(a.createdAt);

	let slip = $derived(pickSlip(docs, opened));
	let earlier = $derived(docs.filter((doc) => doc.id !== slip?.id).sort(newestFirst));
	let slipAnswers = $derived(
		answers && slip && answers.classification.documentId === slip.id ? answers : null
	);

	/** Put the API's latest copy of a document in the list; say so when the slip's has moved on. */
	function replace(next: DocumentRecord, announce = false) {
		const before = docs.find((doc) => doc.id === next.id);
		docs = before ? docs.map((doc) => (doc.id === next.id ? next : doc)) : [next, ...docs];
		if (announce && slip?.id === next.id) {
			const was = before ? stateLabel(before) : null;
			const now = stateLabel(next);
			if (was !== now) announcement = copy.announce(next.originalName, now);
		}
	}

	async function start() {
		load = 'loading';
		try {
			const me = await readMe(fetcher);
			const workspace = me.workspaces[0];
			if (!workspace) {
				load = 'no-workspace';
				return;
			}
			const client = documentsApi(fetcher, workspace.id);
			const [page, companyPage] = await Promise.all([
				client.listDocuments(),
				client.listCompanies()
			]);
			const first = pickSlip(page.items, opened);
			answers = first?.classification ? await client.getClassification(first.id) : null;
			docs = page.items;
			more = page.nextCursor !== null;
			companies = companyPage.items;
			opened = first?.id ?? null;
			api = client;
			load = 'ready';
		} catch {
			load = 'failed';
		}
	}

	onMount(() => {
		hidden = document.hidden;
		start();
	});

	// The slip's answers follow its document: a new set of answers is read once.
	$effect(() => {
		const current = slip;
		const client = api;
		if (!current || !client || !current.classification) return;
		if (slipAnswers?.classification.id === current.classification.id) return;
		let stale = false;
		client
			.getClassification(current.id)
			.then((next) => {
				if (!stale) answers = next;
			})
			.catch(() => {
				// The slip keeps what it has; the next change to the document asks again.
			});
		return () => {
			stale = true;
		};
	});

	async function refresh(docId: string) {
		if (!api) return;
		try {
			replace(await api.getDocument(docId), true);
			pollFailures = 0;
		} catch {
			pollFailures += 1;
		}
	}

	// While Maester works on the slip's document, ask again; never while the tab is hidden.
	$effect(() => {
		const current = slip;
		if (!current || !api || hidden || current.id === uploadingId || !isLive(current)) return;
		const wait = POLL_MS * Math.min(1 + pollFailures, 5);
		const timer = window.setTimeout(() => refresh(current.id), wait);
		return () => window.clearTimeout(timer);
	});

	async function addFile(file: File) {
		problem = null;
		const wrong = checkFile(file);
		if (wrong) {
			problem = { message: wrong };
			return;
		}
		if (!api || uploadingName) return;
		uploadingName = file.name;
		message = null;
		try {
			const done = await api.upload(file, {
				onCreated: (doc) => {
					uploadingId = doc.id;
					opened = doc.id;
					replace(doc);
				}
			});
			uploadingId = null;
			replace(done.document);
			announcement = copy.announce(done.document.originalName, stateLabel(done.document));
		} catch (error) {
			const failure = uploadFailure(error, file);
			problem = { message: failure.message, signIn: failure.signIn };
		} finally {
			uploadingId = null;
			uploadingName = null;
		}
	}

	async function openDoc(docId: string) {
		message = null;
		if (api && !docs.some((doc) => doc.id === docId)) {
			try {
				replace(await api.getDocument(docId));
			} catch (error) {
				message = changeFailure(error).message;
				return;
			}
		}
		opened = docId;
		await tick();
		slipHeading?.focus();
	}

	async function reloadSlip(docId: string) {
		if (!api) return;
		try {
			const [doc, latest] = await Promise.all([
				api.getDocument(docId),
				api.getClassification(docId)
			]);
			answers = latest;
			replace(doc, true);
		} catch {
			// The message already says what happened; the slip keeps what it has.
		}
	}

	async function changeAnswers(change: Change): Promise<boolean> {
		const current = slip;
		const based = slipAnswers;
		if (!api || !current || !based) return false;
		message = null;
		try {
			const result = await api.changeClassification(current.id, {
				basedOn: based.classification.id,
				...change
			});
			if (change.company && 'new' in change.company) {
				companies = (await api.listCompanies().catch(() => null))?.items ?? companies;
			}
			answers = { classification: result.classification, evidence: result.evidence };
			replace(result.document, true);
			return true;
		} catch (error) {
			const failure = changeFailure(error);
			message = failure.message;
			if (failure.reload) await reloadSlip(current.id);
			return false;
		}
	}

	async function again(kind: 'classify' | 'extract') {
		const current = slip;
		if (!api || !current) return;
		message = null;
		try {
			await (kind === 'classify' ? api.classify(current.id) : api.extract(current.id));
			await refresh(current.id);
		} catch (error) {
			const failure = changeFailure(error);
			message = failure.message;
			if (failure.reload) await reloadSlip(current.id);
		}
	}

	/** Sending the bytes is the one step leaving the page would stop. */
	function beforeunload(event: BeforeUnloadEvent) {
		if (uploadingName) event.preventDefault();
	}
</script>

<svelte:window onbeforeunload={beforeunload} />
<svelte:document onvisibilitychange={() => (hidden = document.hidden)} />

<div class="documents">
	<div class="intro">
		<h1>{copy.heading}</h1>
		<p class="lede">{copy.lede}</p>
	</div>

	<DropStrip
		onfile={addFile}
		uploading={uploadingName}
		waitingNote={load === 'ready' ? undefined : `${id}-waiting`}
		{problem}
	/>

	{#if load === 'loading'}
		<div class="desk" aria-busy="true" aria-describedby="{id}-waiting">
			<div class="slip-col">
				<div class="skeleton-slip" aria-hidden="true">
					<div class="skeleton-head"><Hatch width="60%" height="1.5rem" /></div>
					<div class="skeleton-body">
						<Hatch height="4.75rem" />
						<Hatch width="5rem" height="1.25rem" />
						{#each [1, 2, 3, 4] as row (row)}
							<Hatch height="2.75rem" />
						{/each}
					</div>
				</div>
			</div>
			<div class="skeleton-earlier" aria-hidden="true">
				<Hatch width="6rem" height="1.5rem" />
				{#each [1, 2, 3] as row (row)}
					<Hatch height="2.75rem" />
				{/each}
			</div>
		</div>
		<p class="waiting" id="{id}-waiting" role="status">{copy.loading}</p>
	{:else if load === 'failed'}
		<div id="{id}-waiting">
			<SectionIssue
				title={copy.loadFailed.title}
				detail={copy.loadFailed.detail}
				retryLabel={copy.loadFailed.retry}
				onretry={start}
			/>
		</div>
	{:else if load === 'no-workspace'}
		<div id="{id}-waiting">
			<SectionIssue title={copy.noWorkspace.title} detail={copy.noWorkspace.detail} />
		</div>
	{:else}
		<div class={['desk', { solo: !slip }]}>
			{#if slip}
				<div class="slip-col">
					{#key slip.id}
						<Slip
							doc={slip}
							answers={slipAnswers}
							{companies}
							uploading={slip.id === uploadingId}
							{message}
							onchange={changeAnswers}
							onclassify={() => again('classify')}
							onextract={() => again('extract')}
							onopen={openDoc}
							bind:heading={slipHeading}
						/>
					{/key}
					<p class="leaving muted">
						{uploadingName ? copy.leavingWhileSending : copy.leaving}
					</p>
				</div>
			{/if}
			<EarlierList docs={earlier} {more} {uploadingId} onopen={openDoc} />
		</div>
	{/if}

	<p class="visually-hidden" role="status" aria-live="polite">{announcement}</p>
</div>

<style>
	.documents {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		min-width: 0;
	}

	.intro {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	h1 {
		font-stretch: var(--wdth-wide);
		font-weight: 800;
		font-size: 2rem;
		line-height: var(--leading-heading);
		letter-spacing: var(--tracking-heading);
	}

	.lede {
		max-width: var(--measure);
	}

	.desk {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-8);
		align-items: start;
	}

	.slip-col {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}

	.leaving {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
	}

	.waiting {
		font-size: 1rem;
	}

	.skeleton-slip {
		border: var(--rule) solid var(--ink);
	}

	.skeleton-head {
		padding: var(--space-4);
		border-bottom: var(--rule) solid var(--ink);
	}

	.skeleton-body,
	.skeleton-earlier {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.skeleton-body {
		padding: var(--space-4) var(--space-4) var(--space-5);
	}

	@media (min-width: 768px) {
		h1 {
			font-size: var(--text-2xl);
		}
	}

	@media (min-width: 1024px) {
		.desk:not(.solo) {
			grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
		}
	}
</style>
