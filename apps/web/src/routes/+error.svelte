<!--
	Every error the site can show, picked by errorView from the status, the address and the
	connection (design direction C, "The sketchbook"). Public errors use the masthead and the
	register's rail; errors inside the demo terminal stay in its shell. The play scales down
	with the stakes: the not-found sketch follows the pointer, the offline plug can be dragged,
	and inside the terminal the failed-page sketch is small and still; only the offline plug moves there, on a page with no figures. Nothing moves
	on its own. The build writes this page as 404.html, which the web server serves for any
	missing address.
-->
<script lang="ts">
	import { page } from '$app/state';
	import { asset, resolve } from '$app/paths';
	import { content } from '$lib/content';
	import { errorContent } from '$lib/content/errors';
	import {
		checkConnection,
		clockTime,
		errorTime,
		errorView,
		signInAgainHref
	} from '$lib/errors/errors';
	import { listLabels, terminalPages } from '$lib/terminal/pages';
	import Masthead from '$lib/components/Masthead.svelte';
	import TerminalShell from '$lib/components/terminal/TerminalShell.svelte';
	import LedgerSketch from '$lib/components/errors/LedgerSketch.svelte';
	import ComputerSketch from '$lib/components/errors/ComputerSketch.svelte';
	import PlugSketch from '$lib/components/errors/PlugSketch.svelte';

	const c = errorContent;
	const when = errorTime(new Date());

	let path = $derived(page.url.pathname);
	// Once offline, stay on the offline page: when the connection returns, check and reload
	// rather than flipping to "something went wrong", which would blame the wrong thing.
	let offline = $state(typeof navigator !== 'undefined' && navigator.onLine === false);
	let view = $derived(errorView({ status: page.status, path, online: !offline }));
	let signIn = $derived(resolve(signInAgainHref(path)));

	let title = $derived(
		{
			'not-found': c.notFound.title,
			'terminal-not-found': c.terminalNotFound.title,
			failed: c.failed.title,
			offline: c.offline.title,
			'signed-out': c.signedOut.title,
			'no-access': c.noAccess.title
		}[view.kind]
	);

	let looked = $state(false);
	let checkStatus = $state<string>(c.offline.idle);

	async function check(): Promise<boolean> {
		checkStatus = c.offline.checking;
		const ok = await checkConnection(fetch, asset('/robots.txt'));
		if (ok) {
			checkStatus = c.offline.back;
			location.reload();
		} else {
			checkStatus = c.offline.stillOffline(clockTime(new Date()));
		}
		return ok;
	}

	function reload() {
		location.reload();
	}
</script>

<svelte:window
	onoffline={() => (offline = true)}
	ononline={() => {
		if (offline) check();
	}}
/>

<svelte:head>
	<title>{title}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

{#snippet facts(entries: readonly (readonly [string, string])[])}
	<dl class="facts">
		{#each entries as [term, detail] (term)}
			<div class="entry">
				<dt>{term}</dt>
				<dd>{detail}</dd>
			</div>
		{/each}
	</dl>
{/snippet}

{#snippet failedFacts()}
	{@render facts([
		[c.failed.facts.page, path],
		[c.failed.facts.when, when],
		[c.failed.facts.todo, c.failed.facts.todoBody]
	])}
{/snippet}

{#snippet offlineBody()}
	<figure class="plug">
		<PlugSketch label={c.offline.sketch} onplug={check} />
	</figure>
	<p class="status" role="status" aria-live="polite">{checkStatus}</p>
	<button class="button wide-phone" type="button" onclick={check}>{c.offline.primary}</button>
{/snippet}

{#if view.shell}
	<TerminalShell
		demo
		overview="/terminal/demo"
		current={false}
		offlineBanner={view.kind !== 'offline'}
	>
		<div class="in-shell">
			{#if view.kind === 'terminal-not-found'}
				<div class="head">
					<span class="tag">{c.terminalNotFound.tag}</span>
					<h1 class="app">{c.terminalNotFound.heading}</h1>
					<p>{c.terminalNotFound.body}</p>
				</div>
				{@render facts([
					[c.terminalNotFound.asked, path],
					[c.terminalNotFound.demoPages, c.terminalNotFound.demoPageList],
					[c.terminalNotFound.accountPages, listLabels(terminalPages)]
				])}
				<div class="actions">
					<a class="button" href={resolve('/terminal/demo')}>{c.terminalNotFound.primary}</a>
				</div>
			{:else if view.kind === 'offline'}
				<div class="head">
					<span class="tag">{c.offline.tag}</span>
					<h1 class="app">{c.offline.heading}</h1>
					<p>{c.offline.body}</p>
				</div>
				{@render offlineBody()}
			{:else}
				<div class="failed-head">
					<figure class="computer">
						<ComputerSketch label={c.failed.sketch} />
					</figure>
					<div class="head">
						<h1 class="app">{c.failed.heading}</h1>
						<p>{c.failed.body}</p>
					</div>
				</div>
				{@render failedFacts()}
				<div class="actions">
					<button class="button" type="button" onclick={reload}>{c.failed.primary}</button>
					<a href={resolve('/')}>{c.failed.secondary}</a>
				</div>
			{/if}
		</div>
	</TerminalShell>
{:else}
	<div class="page">
		<Masthead {...content.masthead} />

		<main id="main" class="register">
			<div class="rail">
				{#if view.kind === 'not-found'}
					<p class="label">{c.notFound.label}</p>
					<p class="muted">{c.notFound.code}</p>
				{:else if view.kind === 'failed'}
					<p class="label">{c.failed.label}</p>
				{:else if view.kind === 'offline'}
					<p class="label">{c.offline.tag}</p>
				{:else if view.kind === 'signed-out'}
					<p class="label">{c.signedOut.label}</p>
				{:else}
					<p class="label">{c.noAccess.label}</p>
				{/if}
			</div>

			<div class="content">
				{#if view.kind === 'not-found'}
					<div class="copy">
						<h1>{c.notFound.heading}</h1>
						<p class="measure">{c.notFound.body}</p>
						<div class="actions">
							<a class="button" href={resolve('/')}>{c.notFound.primary}</a>
							<a href={resolve('/terminal')}>{c.notFound.secondary}</a>
						</div>
						<p class="hint" aria-live="polite">{looked ? c.notFound.found : c.notFound.hint}</p>
					</div>
					<figure class="scene">
						<LedgerSketch
							label={c.notFound.sketch}
							lens={c.notFound.lens}
							onlook={() => (looked = true)}
						/>
					</figure>
				{:else if view.kind === 'failed'}
					<div class="copy solo">
						<div class="failed-head">
							<figure class="computer">
								<ComputerSketch label={c.failed.sketch} />
							</figure>
							<h1>{c.failed.heading}</h1>
						</div>
						<p class="measure">{c.failed.body}</p>
						{@render failedFacts()}
						<div class="actions">
							<button class="button" type="button" onclick={reload}>{c.failed.primary}</button>
							<a href={resolve('/')}>{c.failed.secondary}</a>
						</div>
					</div>
				{:else if view.kind === 'offline'}
					<div class="copy solo">
						<h1>{c.offline.heading}</h1>
						<p class="measure">{c.offline.body}</p>
						{@render offlineBody()}
					</div>
				{:else if view.kind === 'signed-out'}
					<div class="copy solo">
						<h1>{c.signedOut.heading}</h1>
						<p class="measure">{c.signedOut.body}</p>
						<div class="actions">
							<a class="button" href={signIn}>{c.signedOut.primary}</a>
							<a href={resolve('/')}>{c.signedOut.secondary}</a>
						</div>
					</div>
				{:else}
					<div class="copy solo">
						<h1>{c.noAccess.heading}</h1>
						<p class="measure">{c.noAccess.body}</p>
						<div class="actions">
							<a class="button" href={resolve('/terminal')}>{c.noAccess.primary}</a>
						</div>
					</div>
				{/if}
			</div>
		</main>
	</div>
{/if}

<style>
	/* Masthead, then the register filling the rest of the screen. */
	.page {
		min-height: 100dvh;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
	}

	.register {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		width: 100%;
		max-width: var(--max-width);
		margin: 0 auto;
	}

	.rail {
		padding: var(--space-6) var(--gutter) 0 var(--gutter);
		font-size: var(--text-sm);
		line-height: 1.6;
	}

	.label {
		font-weight: 700;
	}

	.content {
		padding: var(--space-6) var(--gutter) var(--space-14) var(--gutter);
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-10);
		align-content: start;
	}

	.copy {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-6);
		min-width: 0;
	}

	h1 {
		font-stretch: var(--wdth-wide);
		font-weight: 800;
		font-size: var(--text-display);
		line-height: var(--leading-display);
		letter-spacing: var(--tracking-display);
	}

	/* Inside the terminal, headings follow DESIGN.md section 10. */
	h1.app {
		font-size: 2rem;
		line-height: var(--leading-heading);
		letter-spacing: var(--tracking-heading);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-4) var(--space-6);
	}

	.hint,
	.status {
		font-weight: 700;
		font-size: 1rem;
	}

	.scene {
		margin: 0;
		width: 100%;
		max-width: 560px;
	}

	.computer {
		margin: 0;
		width: 160px;
		flex-shrink: 0;
	}

	.plug {
		margin: 0;
		width: 100%;
		max-width: 420px;
	}

	.wide-phone {
		width: 100%;
	}

	/* A spec list: 2px top rule, 1px between entries, 2px closing rule. */
	.facts {
		margin: 0;
		width: 100%;
		max-width: 880px;
		border-top: var(--rule) solid var(--ink);
	}

	.entry {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-1) var(--space-6);
		padding: var(--space-3) 0;
		border-bottom: var(--rule-thin) solid var(--ink-muted);
		font-size: 1rem;
		line-height: var(--leading-small);
	}

	.entry:last-child {
		border-bottom: var(--rule) solid var(--ink);
	}

	dt {
		font-weight: 700;
	}

	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}

	.tag {
		align-self: flex-start;
		border: 1.5px solid var(--ink);
		padding: var(--space-1) var(--space-2);
		font-size: var(--text-sm);
		line-height: 1.2;
	}

	.in-shell {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-7);
		max-width: 880px;
	}

	.head {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.failed-head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: var(--space-6) var(--space-10);
	}

	@media (min-width: 768px) {
		h1.app {
			font-size: var(--text-2xl);
		}

		.entry {
			grid-template-columns: 160px minmax(0, 1fr);
		}

		.wide-phone {
			width: auto;
		}

		.computer {
			width: 200px;
		}
	}

	@media (min-width: 1024px) {
		.register {
			grid-template-columns: var(--rail) minmax(0, 1fr);
		}

		.rail {
			padding: var(--space-12) var(--space-6) var(--space-12) var(--gutter);
			border-right: var(--rule) solid var(--ink);
		}

		.content {
			padding: var(--space-12) var(--gutter) 0 var(--gutter);
			grid-template-columns: minmax(0, 34rem) minmax(0, 1fr);
			gap: var(--space-12);
			align-content: stretch;
		}

		.copy {
			padding-bottom: var(--space-14);
		}

		/* A page with no sketch beside it lets the heading run the full width. */
		.copy.solo {
			grid-column: 1 / -1;
		}

		/* The sketch sits right and fills down to the bottom edge, like the sign-in scene. */
		.scene {
			align-self: end;
			justify-self: end;
		}
	}
</style>
