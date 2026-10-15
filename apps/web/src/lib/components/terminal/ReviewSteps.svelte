<!--
	How a review will run, on the Analyst coming-soon page (DESIGN.md section 5). An ordered list,
	so it is numbered: each step's name, who does it, a spec list of what it reads, writes and never
	does, and its state in words. The step that is the investor's own, Your call, is the ink block.
	Steps sit one under the other in a narrow container and in three columns from 48rem.
-->
<script lang="ts">
	interface Step {
		name: string;
		who: string;
		reads: string;
		writes: string;
		never: string;
		status: string;
		yours: boolean;
	}

	interface Props {
		steps: readonly Step[];
		labels: { reads: string; writes: string; never: string };
	}

	let { steps, labels }: Props = $props();
</script>

<div class="frame">
	<ol class="steps">
		{#each steps as step, index (step.name)}
			<li class={['step', { yours: step.yours }]}>
				<div class="head">
					<h3><span class="number">{index + 1}</span> {step.name}</h3>
					<p class="who">{step.who}</p>
				</div>
				<dl class="spec">
					<div class="entry">
						<dt>{labels.reads}</dt>
						<dd>{step.reads}</dd>
					</div>
					<div class="entry">
						<dt>{labels.writes}</dt>
						<dd>{step.writes}</dd>
					</div>
					<div class="entry">
						<dt>{labels.never}</dt>
						<dd>{step.never}</dd>
					</div>
				</dl>
				<p class="status">{step.status}</p>
			</li>
		{/each}
	</ol>
</div>

<style>
	.frame {
		container-type: inline-size;
	}

	.steps {
		margin: 0;
		padding: 0;
		list-style: none;
		border-top: var(--rule) solid var(--ink);
		border-bottom: var(--rule) solid var(--ink);
	}

	.step {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-3);
		padding: var(--space-4) 0;
	}

	.step + .step {
		border-top: var(--rule-thin) solid var(--ink-muted);
	}

	.step.yours {
		margin: 0 calc(-1 * var(--space-4));
		padding: var(--space-4);
		background: var(--ink);
		color: var(--paper);
	}

	.head {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	h3 {
		font-stretch: var(--wdth-heading);
		font-weight: 700;
		font-size: var(--text-lg);
		line-height: 1.2;
	}

	.number {
		display: inline-block;
		min-width: 1.5em;
		font-size: 1rem;
		font-weight: 400;
		font-variant-numeric: tabular-nums slashed-zero;
		color: var(--ink-muted);
	}

	.who,
	.status {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
		color: var(--ink-muted);
	}

	.yours .number,
	.yours .who,
	.yours .status {
		color: var(--paper-muted);
	}

	.spec {
		margin: 0;
		border-top: var(--rule) solid var(--ink);
		border-bottom: var(--rule) solid var(--ink);
	}

	.entry {
		display: grid;
		grid-template-columns: 4.5rem minmax(0, 1fr);
		gap: var(--space-3);
		padding: var(--space-2) 0;
		font-size: 1rem;
		line-height: var(--leading-small);
	}

	.entry + .entry {
		border-top: var(--rule-thin) solid var(--ink-muted);
	}

	dt {
		font-weight: 700;
	}

	dd {
		margin: 0;
	}

	.yours .spec {
		border-color: var(--paper);
	}

	.yours .entry + .entry {
		border-top-color: var(--paper);
	}

	@container (min-width: 48rem) {
		.step {
			grid-template-columns: 16rem minmax(0, 1fr) 8.5rem;
			gap: var(--space-6);
			align-items: start;
			padding: var(--space-5) 0;
		}

		.step.yours {
			padding: var(--space-5) var(--space-4);
		}

		.who {
			padding-left: 1.5em;
		}

		.entry {
			grid-template-columns: 5rem minmax(0, 1fr);
		}
	}
</style>
