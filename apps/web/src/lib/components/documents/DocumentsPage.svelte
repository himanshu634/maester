<!--
	The Documents page by filing (spec 2026-10-19; plan Decisions 10, 12 and 17). The drop strip,
	then the companies to confirm, then the opened filing beside Working on, then Done. The opened
	filing follows its document wherever a read moves it and is remounted only when the investor
	opens one, a lone upload opens one, or a Change moves its file to another filing, so focus
	stays where it was. It polls its own documents every 2 seconds while it is live; the filings
	are read every 5 seconds while another filing in Working on is live. Neither poll runs while the
	tab is hidden or the investor is signed out. Leaving never cancels anything.
-->
<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { resolve } from '$app/paths';
	import { documentsContent as copy } from '$lib/content/documents';
	import { signInAgainHref } from '$lib/errors/errors';
	import {
		ApiError,
		documentsApi,
		isSignedOut,
		readMe,
		type DocumentsApi,
		type Fetcher
	} from '$lib/documents/client';
	import {
		carryOver,
		endAloud,
		folderOf,
		screen,
		sendAll,
		sendingLine,
		startAloud,
		type Outcome,
		type Picked
	} from '$lib/documents/batch';
	import { changeFailure, LIST_POLL_MS, POLL_MS } from '$lib/documents/intake';
	import {
		CONFIRM_HEADING_ID,
		CONFIRM_SHOWN,
		confirmedAloud,
		confirmFailure,
		confirmRows,
		sectionLede
	} from '$lib/documents/confirm';
	import {
		answersWanted,
		applyDocument,
		buildView,
		filingLive,
		follow,
		forgetAnswers,
		identifying,
		keepFresher,
		listWatched,
		matchesChanged,
		newQuestions,
		owedReads,
		pickFiling,
		pin,
		questionKeys,
		readLedger,
		shapeChanged,
		shapeChangedIds,
		trackContext,
		waitingAbove,
		withUpload,
		type FilingView,
		type Opened
	} from '$lib/documents/filings';
	import { readAgainIds, retryIds } from '$lib/documents/sources';
	import type {
		Company,
		CompanyAnswer,
		ConfirmCompanyRequest,
		DocumentClassification,
		WorkspaceFilings
	} from '$lib/documents/types';
	import Notice from '$lib/components/auth/Notice.svelte';
	import SectionIssue from '$lib/components/errors/SectionIssue.svelte';
	import Hatch from '$lib/components/loading/Hatch.svelte';
	import ConfirmCompanies from './ConfirmCompanies.svelte';
	import DropStrip from './DropStrip.svelte';
	import Filing, { type Change } from './Filing.svelte';
	import FilingList from './FilingList.svelte';

	type Track = 'identify' | 'numbers' | 'text';

	const id = $props.id();
	const fetcher: Fetcher = (url, init) => fetch(url, init);
	const signInHref = resolve(signInAgainHref('/terminal/documents'));
	const NOTHING: WorkspaceFilings = { companies: [], held: [], unsorted: [] };

	let load = $state<'loading' | 'failed' | 'no-workspace' | 'signed-out' | 'ready'>('loading');
	let api = $state.raw<DocumentsApi | null>(null);
	let read = $state.raw<WorkspaceFilings>(NOTHING);
	/** A filings read has arrived, so there is something to show under a signed-out Notice. */
	let loaded = $state(false);
	let companies = $state.raw<Company[]>([]);
	/** Companies reads in flight; until they settle no confirm row is drawn (Task 6). */
	let companyReads = $state(0);
	let confirmExpanded = $state(false);
	/** The filing that is open, pinned to one of its documents (Decision 17). */
	let opened = $state.raw<Opened | null>(null);
	/** Goes up only when a filing is opened on purpose; `Filing` is keyed by it. */
	let openCount = $state(0);
	let answers = $state.raw<Record<string, DocumentClassification | null>>({});
	/** Documents whose answers did not load; asked for again when they change or on "Try again". */
	let answersFailed = $state.raw<string[]>([]);
	/** The documents whose bytes this page is sending. */
	let uploadingIds = $state.raw<string[]>([]);
	/** The drop strip's line while a batch is checked and sent. */
	let busy = $state<string | null>(null);
	/** Files are being sent: closing the tab would stop them. */
	let sending = $state(false);
	/** How the last batch went. */
	let outcome = $state.raw<Outcome | null>(null);
	/** What happened to the investor's last action in the opened filing, when it did not work. */
	let message = $state<string | null>(null);
	let announcement = $state('');
	let hidden = $state(false);
	let filingHeading = $state<HTMLHeadingElement>();
	let filingColumn = $state<HTMLElement>();

	// Bookkeeping, never drawn: plain values, so no effect re-runs when they change.
	let pollFailures = 0;
	let listFailures = 0;
	/** The questions said so far, so none is said twice (Decision 10). */
	let seenQuestions: ReadonlySet<string> = new Set();
	/** Writes fresher than a filings read, and the order reads land in. */
	const ledger = readLedger();
	/** The filings read the opened filing's poll owes until one lands (`owedReads`). */
	const shapeReads = owedReads();
	/** The page is gone: no read it started is sent or applied. */
	let destroyed = false;
	/** Answers being asked for, so one is not asked for twice at once. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never drawn
	const asking = new Set<string>();

	let ctx = $derived(trackContext(read, uploadingIds));
	let view = $derived(buildView(read, ctx));
	let openFiling = $derived(opened ? pickFiling(view, opened) : null);
	let waiting = $derived(openFiling ? null : waitingAbove(view, opened));
	/** The page's companies, with any the read names that the companies page left out. */
	let known = $derived([
		...companies,
		...read.companies
			.map((entry) => entry.company)
			.filter((company) => !companies.some((c) => c.id === company.id))
	]);
	let confirm = $derived(confirmRows(read.held, known, confirmExpanded));
	let companiesLoaded = $derived(companyReads === 0);
	/** With no confirm row and no unnamed file, the opened filing's question is the primary action. */
	let filingPrimary = $derived(confirm.rows.length === 0 && view.unnamed.length === 0);
	let openCompany = $derived(
		openFiling?.companyId
			? (read.companies.find((entry) => entry.company.id === openFiling?.companyId)?.company ??
					null)
			: null
	);
	let showConfirm = $derived(read.held.length > 0 || view.unnamed.length > 0);
	let filingShown = $derived(openFiling !== null || waiting !== null);
	/** The opened filing's key while its own poll should run; null stops it. */
	let pollingKey = $derived(
		load === 'ready' &&
			!hidden &&
			openFiling !== null &&
			filingLive(openFiling, ctx) &&
			!openFiling.files.some((f) => ctx.uploading(f.documentId))
			? openFiling.key
			: null
	);
	let watching = $derived(
		load === 'ready' && !hidden && listWatched(view, openFiling?.key ?? null, ctx)
	);

	const fileHref = (documentId: string) => api?.fileHref(documentId) ?? '';

	/** Say something once, politely; cleared first so the same words twice are said twice. */
	function say(words: string) {
		announcement = '';
		tick().then(() => (announcement = words));
	}

	function signedOut() {
		load = 'signed-out';
	}

	/** New questions, said once; held back while a batch runs or a file is still being identified. */
	function questionsAloud(): string | null {
		if (busy !== null || identifying(read, ctx)) return null;
		const said = newQuestions(seenQuestions, read);
		seenQuestions = said.seen;
		return said.aloud;
	}

	/** Load the opened filing's answers that are missing, or whose file `changed`. */
	function loadAnswers(changed: ReadonlySet<string> = new Set()) {
		const client = api;
		if (!client) return;
		const wanted = answersWanted(openFiling, answers, changed).filter(
			(doc) => !asking.has(doc) && (!answersFailed.includes(doc) || changed.has(doc))
		);
		for (const doc of wanted) {
			asking.add(doc);
			client
				.getClassification(doc)
				.then((next) => {
					answers = { ...answers, [doc]: next };
					answersFailed = answersFailed.filter((x) => x !== doc);
				})
				.catch((error: unknown) => {
					if (isSignedOut(error)) signedOut();
					else if (!answersFailed.includes(doc)) answersFailed = [...answersFailed, doc];
				})
				.finally(() => asking.delete(doc));
		}
	}

	/** "Try again" on answers that did not load. Resolves true when they all loaded. */
	async function reloadAnswers(): Promise<boolean> {
		const client = api;
		const filing = openFiling;
		if (!client || !filing) return false;
		const docs = filing.files.map((f) => f.documentId).filter((d) => answersFailed.includes(d));
		const results = await Promise.allSettled(docs.map((doc) => client.getClassification(doc)));
		let all = true;
		results.forEach((result, i) => {
			const doc = docs[i];
			if (result.status === 'fulfilled') {
				answers = { ...answers, [doc]: result.value };
				answersFailed = answersFailed.filter((x) => x !== doc);
			} else {
				all = false;
				if (isSignedOut(result.reason)) signedOut();
			}
		});
		return all;
	}

	/** Read the companies again; until it settles no confirm row is drawn. */
	async function reloadCompanies() {
		const client = api;
		if (!client) return;
		companyReads += 1;
		try {
			companies = (await client.listCompanies()).items;
		} catch (error) {
			if (isSignedOut(error)) signedOut();
		} finally {
			companyReads -= 1;
		}
	}

	async function focusFiling() {
		await tick();
		filingHeading?.focus();
	}

	/** Open a filing on purpose: remount it, focus its heading, load its answers. */
	function openNew(next: Opened) {
		opened = next;
		openCount += 1;
		message = null;
		focusFiling();
		loadAnswers();
	}

	/**
	 * Focus where the opened document waits: its confirm row, or its unnamed file's Notice. While
	 * the companies are read again no row is drawn yet, so focus goes to the section's heading
	 * rather than falling to the page.
	 */
	async function goToWaiting() {
		const target = waiting;
		if (!target) return;
		if (target.kind === 'held') {
			const at = read.held.findIndex((h) => h.key === target.key);
			if (at >= CONFIRM_SHOWN) confirmExpanded = true;
		}
		await tick();
		const row =
			target.kind === 'held'
				? document.getElementById(`confirm-${target.key}`)
				: document.getElementById(`unnamed-${target.documentId}`);
		(row ?? document.getElementById(CONFIRM_HEADING_ID))?.focus();
	}

	/** A company's heading in Working on, else in Done, else the Working on heading. */
	function focusCompany(companyId: string) {
		const target =
			document.getElementById(`${id}-working-co-${companyId}`) ??
			document.getElementById(`${id}-done-co-${companyId}`) ??
			document.getElementById(`${id}-working-heading`);
		target?.focus();
	}

	/**
	 * Put a filings read on the page: re-pin the opened filing, load the answers that moved, read
	 * the companies again when a held identity's matches changed, and (unless `quiet`) say any new
	 * question. When this read sends the opened document above while focus was in the filing,
	 * focus follows it there.
	 */
	function applyRead(
		next: WorkspaceFilings,
		{ quiet = false, changed = [] }: { quiet?: boolean; changed?: Iterable<string> } = {}
	) {
		const focusWasInFiling = !!filingColumn?.contains(document.activeElement);
		const before = read;
		read = next;
		opened = pin(view, opened);
		if (matchesChanged(before.held, next.held)) reloadCompanies();
		if (focusWasInFiling && waiting) tick().then(goToWaiting);
		if (!quiet) {
			const aloud = questionsAloud();
			if (aloud) say(aloud);
		}
		const moved = new Set([...changed, ...shapeChangedIds(before, next)]);
		answers = forgetAnswers(answers, moved, openFiling?.files.map((f) => f.documentId) ?? []);
		// A file that moved is asked for afresh, whether it is open now or once it is opened.
		if (answersFailed.some((doc) => moved.has(doc))) {
			answersFailed = answersFailed.filter((doc) => !moved.has(doc));
		}
		loadAnswers(moved);
	}

	/**
	 * Read the filings again. A read that began before the last one applied is dropped; files
	 * written since it began (a poll, a change, an upload) keep their fresher state. Resolves true
	 * when the page now shows a read that began with this one or later: this one applied, or it was
	 * dropped for a newer one. False when it failed or the page is gone.
	 */
	async function readFilings(
		opts: { quiet?: boolean; changed?: Iterable<string> } = {}
	): Promise<boolean> {
		const client = api;
		if (!client || destroyed) return false;
		const ticket = ledger.begin();
		let next: WorkspaceFilings;
		try {
			next = await client.listFilings();
			listFailures = 0;
		} catch (error) {
			if (isSignedOut(error)) signedOut();
			else listFailures += 1;
			return false;
		}
		if (destroyed) return false;
		const fresher = ledger.land(ticket);
		if (fresher === null) return true;
		applyRead(keepFresher(read, next, fresher), opts);
		return true;
	}

	/** Read these documents again, then the filings. */
	async function refreshFiles(docs: string[], changed: Iterable<string> = []) {
		const client = api;
		if (!client) return;
		const results = await Promise.allSettled(docs.map((doc) => client.getDocument(doc)));
		for (const result of results) {
			if (result.status === 'rejected') {
				if (isSignedOut(result.reason)) return signedOut();
				continue;
			}
			read = applyDocument(read, result.value);
			ledger.wrote(result.value.id);
		}
		await readFilings({ changed });
	}

	/**
	 * The opened filing's own poll: each of its documents, written in where it sits. When one
	 * changed where it belongs, the filings read is owed until one lands, so a failed read is
	 * tried again on the next tick; when the filing's work stopped, the filings are read once.
	 */
	async function pollOpen() {
		const client = api;
		const filing = openFiling;
		if (!client || !filing || destroyed) return;
		const results = await Promise.allSettled(
			filing.files.map((f) => client.getDocument(f.documentId))
		);
		if (destroyed) return;
		const changed: string[] = [];
		let failed = false;
		results.forEach((result, i) => {
			if (result.status === 'rejected') {
				failed = true;
				if (isSignedOut(result.reason)) signedOut();
				return;
			}
			if (shapeChanged(filing.files[i], result.value)) changed.push(result.value.id);
			read = applyDocument(read, result.value);
			ledger.wrote(result.value.id);
		});
		pollFailures = failed ? pollFailures + 1 : 0;
		shapeReads.owe(changed);
		if (load !== 'ready') return;
		const live = openFiling !== null && filingLive(openFiling, ctx);
		if (!shapeReads.due && live) return;
		const taken = shapeReads.take();
		if (await readFilings({ changed: taken.keys() })) shapeReads.landed(taken);
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
			const ticket = ledger.begin();
			const [filings, companyPage] = await Promise.all([
				client.listFilings(),
				client.listCompanies()
			]);
			ledger.land(ticket);
			api = client;
			companies = companyPage.items;
			read = filings;
			loaded = true;
			seenQuestions = new Set(questionKeys(filings).keys());
			opened = pin(view, opened);
			// The first open does not take focus: the page has only just loaded.
			openCount = Math.max(openCount, 1);
			load = 'ready';
			loadAnswers();
		} catch (error) {
			if (isSignedOut(error)) load = 'signed-out';
			else if (
				error instanceof ApiError &&
				(error.code === 'FORBIDDEN' || error.code === 'NOT_FOUND')
			)
				load = 'no-workspace';
			else load = 'failed';
		}
	}

	onMount(() => {
		hidden = document.hidden;
		start();
		return () => {
			destroyed = true;
		};
	});

	// The opened filing asks for its own documents while it is live. One self-rescheduling timer
	// per opened key; the back-off is read as each wait is set.
	$effect(() => {
		if (pollingKey === null) return;
		let stopped = false;
		let timer: number | undefined;
		const next = () => {
			timer = window.setTimeout(
				async () => {
					await pollOpen();
					if (!stopped) next();
				},
				POLL_MS * Math.min(1 + pollFailures, 5)
			);
		};
		next();
		return () => {
			stopped = true;
			window.clearTimeout(timer);
		};
	});

	// The filings are read again while another filing in Working on is live.
	$effect(() => {
		if (!watching) return;
		let stopped = false;
		let timer: number | undefined;
		const next = () => {
			timer = window.setTimeout(
				async () => {
					await readFilings();
					if (!stopped) next();
				},
				LIST_POLL_MS * Math.min(1 + listFailures, 5)
			);
		};
		next();
		return () => {
			stopped = true;
			window.clearTimeout(timer);
		};
	});

	/**
	 * Add a batch: check every file in the browser, send the rest a few at a time, one document
	 * per file, then say once how it went. A lone file opens as soon as the API has it and takes
	 * focus; a batch holds the opened filing on its first file without moving focus. `carried` is
	 * the batch that "Send the rest" carries on, so its record stays.
	 */
	async function addFiles(picked: Picked[], carried: Outcome | null = null) {
		const client = api;
		if (!client || busy || load !== 'ready' || picked.length === 0) return;
		outcome = null;
		message = null;
		const folder = folderOf(picked);
		busy = copy.drop.checking(picked.length);
		const { accepted, refused } = await screen(picked, folder);
		const lone = accepted.length === 1;
		let result: Pick<Outcome, 'sent' | 'refused' | 'unsent' | 'stopped' | 'rest'> = {
			sent: 0,
			refused: [],
			unsent: 0,
			stopped: null,
			rest: []
		};
		if (accepted.length > 0) {
			busy = sendingLine(0, accepted, folder);
			say(startAloud(accepted, folder));
			let pinned = false;
			sending = true;
			result = await sendAll(
				accepted,
				folder,
				async (item) => {
					let created: string | null = null;
					try {
						const done = await client.upload(item.file, {
							onCreated: (doc) => {
								created = doc.id;
								// Sending before it is added, so it never reads as an abandoned upload.
								uploadingIds = [...uploadingIds, doc.id];
								read = withUpload(read, doc);
								ledger.wrote(doc.id);
								const mine = { key: `file:${doc.id}`, documentId: doc.id, name: doc.originalName };
								if (lone) openNew(mine);
								else if (!pinned) {
									pinned = true;
									opened = mine;
								}
							}
						});
						read = withUpload(read, done.document);
						ledger.wrote(done.document.id);
					} finally {
						if (created) uploadingIds = uploadingIds.filter((doc) => doc !== created);
					}
				},
				(settled) => (busy = sendingLine(settled, accepted, folder))
			);
			sending = false;
		}
		const ended = carryOver(carried, {
			total: picked.length,
			folder,
			...result,
			refused: [...refused, ...result.refused]
		});
		if (ended.stopped === 'signed-out') signedOut();
		await readFilings({ quiet: true });
		// The questions follow the count only once every file is identified (Decision 10).
		const said = identifying(read, ctx) ? null : newQuestions(seenQuestions, read);
		if (said) seenQuestions = said.seen;
		busy = null;
		outcome = ended;
		say([endAloud(ended), said?.aloud].filter(Boolean).join(' '));
	}

	function onopen(filing: FilingView) {
		const [first] = filing.files;
		if (!first) return;
		openNew({ key: filing.key, documentId: first.documentId, name: first.originalName });
	}

	/** Something the investor did in the opened filing was refused: say so, and why. */
	function refusedHere(error: unknown) {
		if (isSignedOut(error)) signedOut();
		message = changeFailure(error).message;
	}

	/**
	 * Save a change to one file's answers. The opened filing follows that file (Review Focus 2):
	 * when it moved to another filing, that one opens and its heading takes focus; otherwise
	 * `Filing` puts focus back on the Change that opened the form.
	 */
	async function onchange(documentId: string, change: Change): Promise<boolean> {
		const client = api;
		const based = answers[documentId];
		if (!client || !based) return false;
		message = null;
		const fromKey = opened?.key ?? null;
		try {
			const result = await client.changeClassification(documentId, {
				basedOn: based.classification.id,
				...change
			});
			if (change.company && 'new' in change.company) await reloadCompanies();
			answers = {
				...answers,
				[documentId]: { classification: result.classification, evidence: result.evidence }
			};
			read = applyDocument(read, result.document);
			ledger.wrote(documentId);
			await readFilings();
			const next = follow(view, documentId, result.document.originalName) ?? opened;
			if (next && next.key !== fromKey) openNew(next);
			else opened = next;
			return true;
		} catch (error) {
			refusedHere(error);
			if (changeFailure(error).reload) await refreshFiles([documentId], [documentId]);
			// A clash with a company added elsewhere: offer the latest list to pick from.
			else if (change.company && 'new' in change.company) await reloadCompanies();
			return false;
		}
	}

	/** A stopped track's "Try again": only the files `retryIds` names. */
	async function onretry(track: Track) {
		const client = api;
		const filing = openFiling;
		if (!client || !filing) return;
		message = null;
		const docs = retryIds(filing.files, filing.filing?.sources ?? [], track);
		const call =
			track === 'identify' ? client.classify : track === 'numbers' ? client.extract : client.index;
		try {
			await Promise.all(docs.map((doc) => call(doc)));
		} catch (error) {
			refusedHere(error);
		}
		await refreshFiles(docs);
	}

	/** "Read it again": `extract` for the files `readAgainIds` names, never any other. */
	async function onreadagain() {
		const client = api;
		const filing = openFiling;
		if (!client || !filing) return;
		message = null;
		const docs = readAgainIds(filing.files, filing.filing?.sources ?? []);
		try {
			await Promise.all(docs.map((doc) => client.extract(doc)));
		} catch (error) {
			refusedHere(error);
		}
		await refreshFiles(docs, docs);
	}

	/**
	 * Confirm a held company for all its files. Focus then goes to the opened filing when this
	 * released the document it waited on, else to the company's heading in Working on.
	 */
	async function onconfirm(
		request: ConfirmCompanyRequest,
		name: string,
		isNew: boolean
	): Promise<string | null> {
		const client = api;
		if (!client) return copy.changeFailed.other;
		const wasWaiting = waiting !== null;
		try {
			const response = await client.confirmCompany(request);
			await Promise.all([readFilings({ quiet: true }), reloadCompanies()]);
			say(confirmedAloud(name, isNew, response));
			await tick();
			if (wasWaiting && openFiling) filingHeading?.focus();
			else focusCompany(response.companyId);
			return null;
		} catch (error) {
			if (isSignedOut(error)) signedOut();
			const failure = confirmFailure(error);
			// A name clash, or files that moved on: read again, so the row offers the company to
			// pick, or goes.
			if (failure.reload) await Promise.all([readFilings({ quiet: true }), reloadCompanies()]);
			return failure.message;
		}
	}

	async function classificationOf(documentId: string): Promise<DocumentClassification | null> {
		try {
			return (await api?.getClassification(documentId)) ?? null;
		} catch (error) {
			if (isSignedOut(error)) signedOut();
			return null;
		}
	}

	/** Say which company a file that prints none belongs to; its filing then opens. */
	async function onanswer(
		documentId: string,
		basedOn: string,
		company: CompanyAnswer
	): Promise<string | null> {
		const client = api;
		if (!client) return copy.changeFailed.other;
		try {
			const result = await client.changeClassification(documentId, { basedOn, company });
			if ('new' in company) await reloadCompanies();
			answers = {
				...answers,
				[documentId]: { classification: result.classification, evidence: result.evidence }
			};
			read = applyDocument(read, result.document);
			ledger.wrote(documentId);
			await readFilings();
			const next = follow(view, documentId, result.document.originalName);
			if (next) openNew(next);
			else tick().then(() => document.getElementById(`${id}-working-heading`)?.focus());
			return null;
		} catch (error) {
			if (isSignedOut(error)) signedOut();
			if ('new' in company) await reloadCompanies();
			return changeFailure(error).message;
		}
	}

	/** Sending the bytes is the one step closing the tab would stop. */
	function beforeunload(event: BeforeUnloadEvent) {
		if (sending) event.preventDefault();
	}
</script>

<svelte:window onbeforeunload={beforeunload} />
<svelte:document onvisibilitychange={() => (hidden = document.hidden)} />

<div class="documents">
	<div class="intro">
		<h1>{copy.heading}</h1>
		<p class="lede">{copy.lede}</p>
	</div>

	{#if load === 'signed-out'}
		<Notice id="{id}-waiting" title={copy.signedOut.title}>
			<p>{copy.signedOut.detail}</p>
			<a href={signInHref}>{copy.signedOut.action}</a>
		</Notice>
	{/if}

	<div class="drop">
		<DropStrip
			onfiles={(picked) => addFiles(picked)}
			onresend={(rest) => addFiles(rest, outcome)}
			{busy}
			{outcome}
			waitingNote={load === 'ready' ? undefined : `${id}-waiting`}
		/>
		{#if sending}<p class="note muted">{copy.leavingWhileSending}</p>{/if}
	</div>

	{#if load === 'loading'}
		<div class="desk" aria-busy="true" aria-describedby="{id}-waiting">
			<div class="skeleton-filing" aria-hidden="true">
				<div class="skeleton-head"><Hatch width="60%" height="1.5rem" /></div>
				<div class="skeleton-body">
					<Hatch height="4rem" />
					<Hatch height="4rem" />
					{#each [1, 2, 3, 4] as row (row)}
						<Hatch height="2.75rem" />
					{/each}
				</div>
			</div>
			<div class="skeleton-list" aria-hidden="true">
				{#each [1, 2] as group (group)}
					<div class="skeleton-group">
						<Hatch width="50%" height="1.5rem" />
						<Hatch height="4.5rem" />
						<Hatch height="4.5rem" />
					</div>
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
	{:else if loaded}
		{#if showConfirm}
			<ConfirmCompanies
				rows={confirm.rows}
				more={confirm.more}
				expanded={confirmExpanded}
				lede={sectionLede(read.held)}
				unnamed={view.unnamed}
				companies={known}
				{companiesLoaded}
				onexpand={() => (confirmExpanded = !confirmExpanded)}
				{onconfirm}
				{classificationOf}
				{onanswer}
			/>
		{/if}

		{#if view.empty}
			<p class="empty">{copy.empty}</p>
		{:else}
			<div class={['desk', { solo: !filingShown || view.working.length === 0 }]}>
				{#if openFiling}
					<div class="filing-col" bind:this={filingColumn}>
						{#key openCount}
							<Filing
								view={openFiling}
								pinned={opened?.documentId ?? openFiling.key}
								company={openCompany}
								companies={known}
								{answers}
								{answersFailed}
								{ctx}
								primaryAvailable={filingPrimary}
								{message}
								{fileHref}
								{onchange}
								{onretry}
								{onreadagain}
								onreload={reloadAnswers}
								bind:heading={filingHeading}
							/>
						{/key}
					</div>
				{:else if waiting}
					<div class="filing-col">
						<Notice role="note" title={copy.waiting.title(waiting.name)}>
							<p>{waiting.kind === 'held' ? copy.waiting.held : copy.waiting.unnamed}</p>
							<button class="button outline" type="button" onclick={goToWaiting}>
								{copy.waiting.action}
							</button>
						</Notice>
					</div>
				{/if}
				{#if view.working.length > 0}
					<FilingList
						heading={copy.sections.working}
						count={view.workingCount}
						groups={view.working}
						collapse={false}
						openedKey={openFiling?.key ?? null}
						{onopen}
						idPrefix="{id}-working"
					/>
				{/if}
			</div>

			{#if view.done.length > 0}
				<FilingList
					heading={copy.sections.done}
					count={view.doneCount}
					groups={view.done}
					collapse
					openedKey={openFiling?.key ?? null}
					{onopen}
					idPrefix="{id}-done"
				/>
			{/if}
		{/if}
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

	.intro,
	.drop {
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

	.lede,
	.note,
	.empty {
		max-width: var(--measure);
	}

	.note {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
	}

	.desk {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-8);
		align-items: start;
	}

	.filing-col {
		min-width: 0;
	}

	.waiting {
		font-size: 1rem;
	}

	.skeleton-filing {
		border: var(--rule) solid var(--ink);
	}

	.skeleton-head {
		padding: var(--space-4);
		border-bottom: var(--rule) solid var(--ink);
	}

	.skeleton-body,
	.skeleton-list,
	.skeleton-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.skeleton-body {
		padding: var(--space-4) var(--space-4) var(--space-5);
	}

	.skeleton-list {
		gap: var(--space-6);
	}

	@media (min-width: 768px) {
		h1 {
			font-size: var(--text-2xl);
		}
	}

	@media (min-width: 1024px) {
		.desk:not(.solo) {
			grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
		}
	}
</style>
