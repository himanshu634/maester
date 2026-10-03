<script lang="ts">
	/** Between two ways of doing one thing: 1px muted rules either side of a label. */
	let { label }: { label: string } = $props();
</script>

<p class="or"><span>{label}</span></p>

<style>
	.or {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		color: var(--ink-muted);
		font-size: var(--text-sm);
	}

	.or::before,
	.or::after {
		content: '';
		flex: 1;
		height: var(--rule-thin);
		background: var(--ink-muted);
	}
</style>
