<!--
	"What is it?": an annual report, financial results (and for which period), or another company
	document (and which kind). Used when Maester couldn't tell, and to change its answer.
-->
<script module lang="ts">
	import type { ChosenKind, OtherType, ResultsSpan } from '$lib/documents/types';

	export interface KindAnswer {
		kind: ChosenKind;
		otherType: OtherType | null;
		resultsSpan: ResultsSpan | null;
	}
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import { documentsContent as copy } from '$lib/content/documents';
	import { OTHER_TYPES, RESULTS_SPANS, type ClassificationKind } from '$lib/documents/types';

	interface Props {
		initial?: {
			kind: ClassificationKind;
			otherType: OtherType | null;
			resultsSpan: ResultsSpan | null;
		};
		submitLabel: string;
		/** The screen's one primary action: filled. Otherwise outlined. */
		primary?: boolean;
		busy?: boolean;
		onsubmit: (answer: KindAnswer) => void;
		oncancel?: () => void;
	}

	let { initial, submitLabel, primary = false, busy = false, onsubmit, oncancel }: Props = $props();

	const id = $props.id();
	const kinds: ChosenKind[] = ['annual_report', 'financial_results', 'other'];

	// The form starts from the current answer and is the investor's from then on.
	const start = untrack(() => initial);
	let kind = $state<ChosenKind | null>(start && start.kind !== 'not_sure' ? start.kind : null);
	let otherType = $state<OtherType>(start?.otherType ?? 'unlisted_type');
	let resultsSpan = $state<ResultsSpan | ''>(start?.resultsSpan ?? '');
	let missing = $state(false);

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!kind) {
			missing = true;
			return;
		}
		onsubmit({
			kind,
			otherType: kind === 'other' ? otherType : null,
			resultsSpan: kind === 'financial_results' && resultsSpan ? resultsSpan : null
		});
	}
</script>

<form class="kind-form" onsubmit={submit} novalidate>
	<fieldset aria-describedby={missing ? `${id}-missing` : undefined}>
		<legend>{copy.kind.legend}</legend>
		{#each kinds as choice (choice)}
			<label class="choice">
				<input
					type="radio"
					name="{id}-kind"
					value={choice}
					bind:group={kind}
					onchange={() => (missing = false)}
				/>
				<span class="text">
					<span class="label">{copy.kind.choices[choice].label}</span>
					<span class="hint">{copy.kind.choices[choice].hint}</span>
				</span>
			</label>
		{/each}
		{#if missing}
			<p class="error" id="{id}-missing">{copy.kind.missing}</p>
		{/if}
	</fieldset>

	{#if kind === 'other'}
		<div class="field">
			<label for="{id}-type">{copy.kind.typeLabel}</label>
			<select id="{id}-type" bind:value={otherType}>
				{#each OTHER_TYPES as type (type)}
					<option value={type}>{copy.otherTypes[type]}</option>
				{/each}
			</select>
		</div>
	{:else if kind === 'financial_results'}
		<div class="field">
			<label for="{id}-span">{copy.kind.spanLabel}</label>
			<select id="{id}-span" bind:value={resultsSpan}>
				<option value="">{copy.kind.spanUnknown}</option>
				{#each RESULTS_SPANS as span (span)}
					<option value={span}>{copy.spans[span]}</option>
				{/each}
			</select>
		</div>
	{/if}

	<div class="actions">
		<button class={['button', { outline: !primary }]} type="submit" disabled={busy}>
			{submitLabel}
		</button>
		{#if oncancel}
			<button class="button outline" type="button" onclick={oncancel}>{copy.slip.cancel}</button>
		{/if}
	</div>
</form>

<style>
	.kind-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		width: 100%;
	}

	fieldset {
		border: 0;
		margin: 0;
		padding: 0;
		min-width: 0;
		border-bottom: var(--rule-thin) solid var(--ink-muted);
	}

	legend {
		padding: 0;
		margin-bottom: var(--space-2);
		font-weight: 700;
	}

	.choice {
		display: flex;
		gap: var(--space-3);
		align-items: flex-start;
		min-height: var(--target);
		padding: var(--space-3) 0;
		border-top: var(--rule-thin) solid var(--ink-muted);
		cursor: pointer;
	}

	input[type='radio'] {
		flex-shrink: 0;
		width: 20px;
		height: 20px;
		margin: 2px 0 0;
		accent-color: var(--ink);
	}

	.text {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.label {
		font-weight: 700;
		font-size: 1rem;
	}

	.hint {
		font-size: var(--text-sm);
		line-height: var(--leading-small);
		color: var(--ink-muted);
	}

	.error {
		padding-bottom: var(--space-3);
		font-size: var(--text-sm);
		font-weight: 700;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		max-width: 24rem;
	}

	.field label {
		font-weight: 700;
		font-size: var(--text-sm);
	}

	select {
		min-height: var(--target);
		padding: 0 var(--space-3);
		border: var(--rule) solid var(--ink);
		border-radius: var(--radius);
		background: var(--paper);
		color: var(--ink);
		font: inherit;
		font-size: 1rem;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}
</style>
