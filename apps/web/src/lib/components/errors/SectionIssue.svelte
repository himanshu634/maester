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
	}

	let { title, detail, retryLabel, onretry }: Props = $props();
</script>

<div class="issue" role="status">
	<p class="title">{title}</p>
	<p class="detail">{detail}</p>
	{#if onretry && retryLabel}
		<button class="button outline" type="button" onclick={onretry}>{retryLabel}</button>
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
</style>
