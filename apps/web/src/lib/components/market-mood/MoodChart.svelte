<!--
	A line over time, ink only, on one axis: the mood's 12 months (0–100, with band lines and, when
	wide enough, band names), a reading's 2 years (its own domain) or a share's year of closes (the
	Research summary). The last point is marked and labelled; the year's low and high too, when
	asked. Drawn in pixels from the container's width so labels stay 14px. "Show as a table" gives
	the same figures as a table, newest first.
-->
<script lang="ts">
	import { marketMoodContent as copy } from '$lib/content/market-mood';
	import { bandLabel, dayMonth } from '$lib/market-mood/view';
	import {
		axisValues,
		CHART_HEIGHT,
		frameFor,
		highest,
		linePath,
		lowest,
		monthTicks,
		scales
	} from '$lib/market-mood/chart';
	import type { MoodBand } from '$lib/market-mood/types';

	interface Props {
		points: { day: string; value: number }[];
		domain: [number, number];
		/** The mood chart: band lines at 20, 40, 60, 80 and band names at the right. */
		bands?: boolean;
		/** Text alternative for the drawing. */
		label: string;
		/** Table figures, and the axis labels unless `axisFormat` is given. */
		format: (value: number) => string;
		/** Axis labels, when they differ from the table's (a short rupee form, say). */
		axisFormat?: (value: number) => string;
		todayLabel: string;
		/** Label for the lowest point, or null to leave it unmarked. */
		lowLabel?: ((value: number, day: string) => string) | null;
		/** Label for the highest point, or null to leave it unmarked. */
		highLabel?: ((value: number, day: string) => string) | null;
		/** Width of the left gutter in pixels, for longer axis labels. */
		gutter?: number;
		withYear?: boolean;
		valueHeader: string;
	}

	let {
		points,
		domain,
		bands = false,
		label,
		format,
		axisFormat,
		todayLabel,
		lowLabel = null,
		highLabel = null,
		gutter = 48,
		withYear = false,
		valueHeader
	}: Props = $props();

	const id = $props.id();
	const BANDS: MoodBand[] = ['very_cautious', 'cautious', 'middling', 'eager', 'very_eager'];

	let width = $state(0);
	let showTable = $state(false);

	let values = $derived(points.map((p) => p.value));
	let frame = $derived(frameFor(width, { bandNames: bands, left: gutter }));
	let s = $derived(scales(points.length, frame, domain));
	let path = $derived(linePath(values, s));
	let ticks = $derived(
		monthTicks(
			points.map((p) => p.day),
			s,
			withYear
		)
	);
	let last = $derived(points.length - 1);
	let low = $derived(lowLabel ? lowest(values) : null);
	let high = $derived(highLabel ? highest(values) : null);
	let axis = $derived(axisFormat ?? format);
	let right = $derived(width - frame.right);
	let floor = $derived(s.y(domain[0]));
	let newestFirst = $derived([...points].reverse());
	let tx = $derived(s.x(last));
	let ty = $derived(last >= 0 ? s.y(values[last]!) : 0);
</script>

<div class="chart">
	<div class="drawing" bind:clientWidth={width} style:height="{CHART_HEIGHT}px">
		{#if width > 0 && points.length > 0}
			<svg {width} height={CHART_HEIGHT} role="img" aria-label={label}>
				{#if bands}
					{#each [20, 40, 60, 80] as at (at)}
						<line class="band" x1={frame.left} x2={right} y1={s.y(at)} y2={s.y(at)} />
					{/each}
					{#if frame.right > 20}
						{#each BANDS as name, i (name)}
							<text class="muted-text" x={right + 12} y={s.y(i * 20 + 10) + 5}>
								{bandLabel(name)}
							</text>
						{/each}
					{/if}
				{:else}
					<line
						class="band dashed"
						x1={frame.left}
						x2={right}
						y1={s.y(axisValues(domain)[1]!)}
						y2={s.y(axisValues(domain)[1]!)}
					/>
				{/if}
				<line class="axis" x1={frame.left} x2={right} y1={floor} y2={floor} />
				{#each axisValues(domain) as v (v)}
					<text class="muted-text" x={frame.left - 8} y={s.y(v) + 5} text-anchor="end">
						{axis(v)}
					</text>
				{/each}
				{#each ticks as tick (tick.x)}
					<text class="muted-text" x={tick.x} y={CHART_HEIGHT - 6} text-anchor="middle">
						{tick.label}
					</text>
				{/each}
				<path class="line" d={path} />
				{#if low !== null && low !== last}
					{@const lx = s.x(low)}
					{@const ly = s.y(values[low]!)}
					{@const leftward = lx > right - 160}
					<rect class="mark" x={lx - 3} y={ly - 3} width="6" height="6" />
					<text
						class="halo"
						x={leftward ? lx - 9 : lx + 9}
						y={Math.min(ly + 5, floor - 6)}
						text-anchor={leftward ? 'end' : 'start'}
					>
						{lowLabel!(values[low]!, dayMonth(points[low]!.day))}
					</text>
				{/if}
				{#if high !== null && high !== last && high !== low}
					{@const hx = s.x(high)}
					{@const hy = s.y(values[high]!)}
					{@const leftward = hx > right - 160}
					<rect class="mark" x={hx - 3} y={hy - 3} width="6" height="6" />
					<text
						class="halo"
						x={leftward ? hx - 9 : hx + 9}
						y={Math.max(hy - 10, frame.top + 12)}
						text-anchor={leftward ? 'end' : 'start'}
					>
						{highLabel!(values[high]!, dayMonth(points[high]!.day))}
					</text>
				{/if}
				<rect class="mark" x={tx - 4} y={ty - 4} width="8" height="8" />
				<text
					class="today halo"
					x={tx - 8}
					y={ty < floor - 32 ? ty + 24 : ty - 10}
					text-anchor="end"
				>
					{todayLabel}
				</text>
			</svg>
		{/if}
	</div>
	<button
		type="button"
		class="button outline toggle"
		aria-expanded={showTable}
		aria-controls="{id}-table"
		onclick={() => (showTable = !showTable)}
	>
		{showTable ? copy.hideTable : copy.showTable}
	</button>
	<!-- A region that scrolls must take focus so keyboard users can scroll it (WCAG 2.1.1). -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		id="{id}-table"
		class="scroll-x table-wrap"
		role="region"
		aria-label={label}
		tabindex="0"
		hidden={!showTable}
	>
		{#if showTable}
			<table>
				<caption class="visually-hidden">{label}</caption>
				<thead>
					<tr><th scope="col">{copy.chart.day}</th><th scope="col">{valueHeader}</th></tr>
				</thead>
				<tbody>
					{#each newestFirst as p (p.day)}
						<tr>
							<td class="num">{dayMonth(p.day)} {p.day.slice(0, 4)}</td>
							<td class="num figure">{format(p.value)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
</div>

<style>
	.chart {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-3);
		min-width: 0;
	}

	.drawing {
		align-self: stretch;
		min-width: 0;
	}

	svg {
		display: block;
		overflow: visible;
		font-family: inherit;
	}

	text {
		font-size: 14px;
		fill: var(--ink);
		font-variant-numeric: tabular-nums slashed-zero;
	}

	.muted-text {
		fill: var(--ink-muted);
	}

	.today {
		font-weight: 700;
	}

	/* Paper behind a label that sits on the line, so it stays readable. */
	.halo {
		paint-order: stroke;
		stroke: var(--paper);
		stroke-width: 4px;
		stroke-linejoin: round;
	}

	.axis {
		stroke: var(--ink);
		stroke-width: 2;
	}

	.band {
		stroke: var(--ink-muted);
		stroke-width: 1;
	}

	.dashed {
		stroke-dasharray: 4 4;
	}

	.line {
		fill: none;
		stroke: var(--ink);
		stroke-width: 2;
		stroke-linejoin: round;
	}

	.mark {
		fill: var(--ink);
	}

	.table-wrap {
		align-self: stretch;
		max-height: 24rem;
		overflow-y: auto;
		border-top: var(--rule) solid var(--ink);
		border-bottom: var(--rule) solid var(--ink);
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-sm);
	}

	th {
		text-align: left;
		padding: var(--space-2) 0;
		border-bottom: var(--rule) solid var(--ink);
	}

	th + th,
	.figure {
		text-align: right;
	}

	td {
		padding: var(--space-2) 0;
		border-top: var(--rule-thin) solid var(--ink-muted);
	}
</style>
