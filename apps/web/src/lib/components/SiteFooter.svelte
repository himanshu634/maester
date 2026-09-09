<script lang="ts">
	interface Props {
		wordmark: string;
		note: string;
	}

	let { wordmark, note }: Props = $props();
</script>

<div class="footer">
	<p class="muted note measure">{note}</p>
	<span class="wordmark" aria-hidden="true">{wordmark}</span>
</div>

<style>
	.footer {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		font-size: var(--text-sm);
	}

	.wordmark {
		font-stretch: var(--wdth-wide);
		font-weight: 800;
		font-size: var(--text-lg);
		letter-spacing: var(--tracking-heading);
	}
</style>
