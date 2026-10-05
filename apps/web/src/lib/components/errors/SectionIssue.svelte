<!--
	A section of a terminal page that didn't load: a 2px box with a bold first line saying
	what failed, a line saying what is still current, and an optional way to try again. The
	rest of the page keeps working, and figures that need the missing data show "—".
	(UI_SPECIFICATION section 12, DataIssue: a local, actionable explanation, never an
	unexplained banner.)
-->
<script lang="ts">
	interface Props {
		title: string;
		detail: string;
		retryLabel?: string;
		onretry?: () => void;
		/**
		 * `status` (the default) announces the issue when it appears. `note` is for a page that
		 * already says what changed through its own status line, so it is said once.
		 */
		role?: 'status' | 'note';
		/** The retry is running: the button is disabled and points at this visible line. */
		busy?: string | null;
		/**
		 * What the last retry came to, said politely, so a retry that changed nothing is still
		 * heard. When given, its status line is always in the page, empty until there is news.
		 */
		outcome?: string;
	}

	let {
		title,
		detail,
		retryLabel,
		onretry,
		role = 'status',
		busy = null,
		outcome
	}: Props = $props();

	const id = $props.id();
</script>

<div class="issue" {role}>
	<p class="title">{title}</p>
	<p class="detail">{detail}</p>
	{#if onretry && retryLabel}
		<button
			class="button outline"
			type="button"
			disabled={!!busy}
			aria-describedby={busy ? `${id}-busy` : undefined}
			onclick={onretry}>{retryLabel}</button
		>
		{#if busy}<p class="detail muted" id="{id}-busy">{busy}</p>{/if}
	{/if}
	{#if outcome !== undefined}
		<p class="detail outcome" role="status" aria-live="polite">{outcome}</p>
	{/if}
</div>

<style>
	.issue {
		border: var(--rule) solid var(--ink);
		padding: var(--space-4) var(--space-5);
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		max-width: var(--measure);
	}

	.title {
		font-weight: 700;
	}

	.detail {
		font-size: 1rem;
		line-height: var(--leading-small);
	}

	.button {
		margin-top: var(--space-2);
	}

	.outcome:empty {
		display: none;
	}
</style>
