<!--
	Where a document stands, as an ordered sequence: Uploaded, Worked out what it is, Reading the
	statements, Ready. Each step says its state in a word (Done, Now, Next, Needs you, Stopped,
	Not read), never a colour; the current step (Now or Needs you) is an ink block. Four across when there is
	room, one under another when there is not.
-->
<script lang="ts">
	import type { Step } from '$lib/documents/intake';

	interface Props {
		steps: Step[];
		label: string;
	}

	let { steps, label }: Props = $props();
</script>

<div class="ladder-box">
	<ol class="ladder" aria-label={label}>
		{#each steps as step, index (step.label)}
			<li
				class={['step', step.status]}
				aria-current={step.status === 'now' || step.status === 'needs-you' ? 'step' : undefined}
			>
				<span class="number num" aria-hidden="true">{index + 1}</span>
				<span class="name">{step.label}</span>
				<span class="word">{step.word}</span>
			</li>
		{/each}
	</ol>
</div>

<style>
	.ladder-box {
		container-type: inline-size;
	}

	.ladder {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		border-top: var(--rule) solid var(--ink);
		border-bottom: var(--rule) solid var(--ink);
	}

	.step {
		display: grid;
		grid-template-columns: var(--space-6) minmax(0, 1fr) auto;
		align-items: baseline;
		gap: var(--space-3);
		padding: var(--space-3) 0;
	}

	.step + .step {
		border-top: var(--rule-thin) solid var(--ink-muted);
	}

	.number {
		font-size: var(--text-sm);
		color: var(--ink-muted);
	}

	.name {
		font-size: 1rem;
		font-weight: 700;
		line-height: 1.3;
	}

	.word {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
		color: var(--ink-muted);
	}

	.done .word,
	.stopped .word {
		color: var(--ink);
	}

	.stopped .word {
		font-weight: 700;
	}

	/* The current step, whether Maester is on it or it waits for the investor: an ink block. */
	.now,
	.needs-you {
		padding-inline: var(--space-3);
		background: var(--ink);
		color: var(--paper);
	}

	.now .number,
	.needs-you .number {
		color: var(--paper-muted);
	}

	.now .word,
	.needs-you .word {
		color: var(--paper);
		font-weight: 700;
	}

	@container (min-width: 32rem) {
		.ladder {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}

		.step {
			grid-template-columns: minmax(0, 1fr);
			align-content: start;
			gap: var(--space-1);
			padding: var(--space-3);
		}

		.step:first-child:not(.now, .needs-you) {
			padding-left: 0;
		}

		.step + .step {
			border-top: 0;
			border-left: var(--rule-thin) solid var(--ink-muted);
		}
	}
</style>
