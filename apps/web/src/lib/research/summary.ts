/**
 * The stock and business summary on a company's page: one sentence filled in by rule (never by
 * a model), and four headline figures. Prices are the investor's own Dhan closes; the business
 * figures are the newest year read. Price to earnings divides the last close by the basic
 * earnings per share the annual report prints. Unknown is "—" with its reason; never advice.
 */
import { researchContent as copy } from '$lib/content/research';
import { percent, price } from '$lib/terminal/format';
import type { CompanyFinancials, CompanyStock, FinancialRow, StatementTable } from './types';
import { fyLabel, unitShort, unitWords } from './view';

export interface SummaryFigure {
	label: string;
	value: string | null;
	reason: string | null;
	change: string | null;
	note: string | null;
	rulerPct: number | null;
	settingsLink: boolean;
}
export interface Summary {
	sentence: string | null;
	figures: [SummaryFigure, SummaryFigure, SummaryFigure, SummaryFigure];
	epsCell: { tableIndex: number; row: number; col: number } | null;
}

const MINUS = '−';
const whole = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const two = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const longFmt = new Intl.DateTimeFormat('en-GB', {
	weekday: 'long',
	day: 'numeric',
	month: 'long',
	timeZone: 'UTC'
});
const weekdayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' });
const shortFmt = new Intl.DateTimeFormat('en-GB', {
	day: 'numeric',
	month: 'short',
	timeZone: 'UTC'
});
const at = (day: string) => new Date(`${day}T00:00:00Z`);

export const shortName = (name: string) => name.replace(/\s+(limited|ltd\.?)$/i, '').trim();
/** "Friday 9 October". */
export const longDay = (day: string) => longFmt.format(at(day)).replace(',', '');
/** "9 Oct". */
export const shortDay = (day: string) => shortFmt.format(at(day));

const signed = (n: number) => `${n < 0 ? MINUS : '+'}${two.format(Math.abs(n))}`;
const signedPct = (n: number, digits = 1) =>
	`${n < 0 ? MINUS : '+'}${percent(Math.abs(n), digits)}`;
const change = (now: number, before: number) => ((now - before) / Math.abs(before)) * 100;
const norm = (s: string) =>
	s
		.toLowerCase()
		.replace(/[^a-z ]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

const REVENUE =
	/^(revenue from operations|total revenue from operations|income from operations|revenue)$/;
const PROFIT =
	/^(net )?(profit|profit loss|loss) (for|after tax for) the (year|period)$|^(net profit|profit after tax)$/;

/** The profit and loss to summarise: consolidated if read, otherwise standalone. */
function profitAndLoss(
	f: CompanyFinancials | null
): { table: StatementTable; index: number } | null {
	if (!f) return null;
	for (const basis of ['consolidated', 'standalone', 'unknown'] as const) {
		const index = f.tables.findIndex(
			(t) => t.statement === 'income_statement' && t.basis === basis
		);
		if (index >= 0) return { table: f.tables[index]!, index };
	}
	return null;
}

/** The newest column with a figure, and the figure in the column before it. */
function latest(row: FinancialRow): { now: number; col: number; before: number | null } | null {
	const cells = row.cells;
	for (let c = cells.length - 1; c >= 0; c--) {
		const cell = cells[c]!;
		if (cell.status === 'value' && cell.value !== null) {
			const prev = c > 0 ? cells[c - 1]! : null;
			return {
				now: Number(cell.value),
				col: c,
				before: prev && prev.status === 'value' && prev.value !== null ? Number(prev.value) : null
			};
		}
	}
	return null;
}

const blank = (label: string): SummaryFigure => ({
	label,
	value: null,
	reason: null,
	change: null,
	note: null,
	rulerPct: null,
	settingsLink: false
});

export function summarize(input: {
	financials: CompanyFinancials | null;
	stock: CompanyStock | null;
	stockFailed: boolean;
}): Summary {
	const { financials, stock } = input;
	const name = financials ? shortName(financials.company.displayName) : '';
	const ok = !input.stockFailed && stock?.state === 'ok' && stock.last !== null ? stock : null;
	const noPrice =
		input.stockFailed || !stock
			? copy.summary.noPrice.failed
			: stock.state === 'ok'
				? copy.summary.noPrice.failed
				: copy.summary.noPrice[stock.state];

	// Price figures.
	const close = blank(copy.summary.labels.close);
	const range = blank(copy.summary.labels.range);
	if (ok) {
		const last = ok.last!;
		close.value = price(last.value);
		close.note = copy.summary.closeNote(`${weekdayFmt.format(at(last.day))} ${shortDay(last.day)}`);
		if (ok.previous) {
			close.change = copy.summary.dayChange(
				signed(last.value - ok.previous.value),
				signedPct(change(last.value, ok.previous.value), 2)
			);
		}
		if (ok.low && ok.high) {
			range.value = `${price(ok.low.value)} – ${two.format(ok.high.value)}`;
			range.rulerPct =
				ok.high.value > ok.low.value
					? Math.round(((last.value - ok.low.value) / (ok.high.value - ok.low.value)) * 100)
					: 50;
			range.note = copy.summary.rangeNote(shortDay(ok.low.day), shortDay(ok.high.day));
		}
	} else {
		close.reason = noPrice;
		close.settingsLink = !input.stockFailed && stock?.state === 'not_connected';
		range.reason = copy.summary.needsCloses;
	}

	// Business figures, the sentence's second part, and price to earnings.
	const profitFig = blank(copy.summary.labels.profitUnknown);
	const pe = blank(copy.summary.labels.pe);
	let business: string | null = null;
	let epsCell: Summary['epsCell'] = null;
	const pl = profitAndLoss(financials);
	if (!pl) {
		profitFig.reason = copy.summary.noFigures;
		pe.reason = ok ? copy.summary.noFigures : copy.summary.needsPrice;
	} else {
		const { table, index } = pl;
		const short = unitShort(table.unit);
		const word = unitWords(table.unit).replace(/^₹ ?/, '');
		const money = (n: number, compact: boolean) => {
			const unit = compact ? short : word;
			return `₹${whole.format(Math.abs(n))}${unit ? ` ${unit}` : ''}`;
		};
		const revIndex = table.rows.findIndex((r) => !r.perShare && REVENUE.test(norm(r.label)));
		const profIndex = table.rows.findIndex((r) => !r.perShare && PROFIT.test(norm(r.label)));
		const basicIndex = table.rows.findIndex(
			(r) => r.perShare && /basic/.test(norm(`${r.section} ${r.label}`))
		);
		const epsIndex = basicIndex >= 0 ? basicIndex : table.rows.findIndex((r) => r.perShare);
		const rev = revIndex >= 0 ? latest(table.rows[revIndex]!) : null;
		const prof = profIndex >= 0 ? latest(table.rows[profIndex]!) : null;
		const anchor = prof ?? rev;
		const fy = anchor ? fyLabel(table.columns[anchor.col]!.periodEnd) : null;

		if (prof && fy) {
			profitFig.label = copy.summary.labels.profit(fy);
			profitFig.value = `${prof.now < 0 ? MINUS : ''}${money(prof.now, true)}`;
			if (prof.before !== null && prof.before > 0 && prof.now > 0 && prof.col > 0) {
				profitFig.change = copy.summary.profitChange(
					signedPct(change(prof.now, prof.before)),
					fyLabel(table.columns[prof.col - 1]!.periodEnd)
				);
			}
			const revChange = rev && rev.before ? signedPct(change(rev.now, rev.before)) : null;
			profitFig.note = copy.summary.profitNote(
				`${table.basis === 'standalone' ? 'Standalone' : 'Consolidated'}.`,
				rev ? money(rev.now, true) : null,
				revChange
			);
		} else {
			profitFig.reason = copy.summary.noFigures;
		}

		// "In 2025–26 its revenue grew 7.7% to ₹12,105 crore and its profit grew 27.5% to ₹1,459 crore."
		// The first clause names the owner: "its" after the price sentence, the company otherwise.
		const owner = ok ? 'its' : name.endsWith('s') ? `${name}’` : `${name}’s`;
		const revClause = (who: string) =>
			!rev
				? null
				: rev.before
					? `${who} revenue ${rev.now >= rev.before ? 'grew' : 'fell'} ${percent(Math.abs(change(rev.now, rev.before)))} to ${money(rev.now, false)}`
					: `${who} revenue was ${money(rev.now, false)}`;
		const profClause = (who: string) => {
			if (!prof) return null;
			if (prof.now >= 0 && prof.before !== null && prof.before > 0) {
				return `${who} profit ${prof.now >= prof.before ? 'grew' : 'fell'} ${percent(Math.abs(change(prof.now, prof.before)))} to ${money(prof.now, false)}`;
			}
			if (prof.now >= 0) {
				return `${who} profit was ${money(prof.now, false)}${prof.before !== null && prof.before < 0 ? `, against a loss of ${money(prof.before, false)} the year before` : ''}`;
			}
			const against =
				prof.before === null
					? ''
					: prof.before < 0
						? `, against a loss of ${money(prof.before, false)} the year before`
						: `, against a profit of ${money(prof.before, false)} the year before`;
			return `it made a loss of ${money(prof.now, false)}${against}`;
		};
		const clauses = rev ? [revClause(owner), profClause('its')] : [profClause(owner)];
		const said = clauses.filter((c): c is string => c !== null);
		if (fy && said.length) business = `In ${fy} ${said.join(' and ')}.`;

		// Price to earnings: the last close ÷ the printed basic earnings per share.
		const eps = epsIndex >= 0 ? latest(table.rows[epsIndex]!) : null;
		if (eps) epsCell = { tableIndex: index, row: epsIndex, col: eps.col };
		if (!ok) pe.reason = copy.summary.needsPrice;
		else if (!eps) pe.reason = copy.summary.noEps;
		else if (eps.now <= 0)
			pe.reason = copy.summary.loss(fyLabel(table.columns[eps.col]!.periodEnd));
		else {
			const cell = table.rows[epsIndex]!.cells[eps.col]!;
			pe.value = (ok.last!.value / eps.now).toFixed(1);
			pe.note = copy.summary.peNote(
				two.format(ok.last!.value),
				two.format(eps.now),
				fyLabel(table.columns[eps.col]!.periodEnd),
				(cell.source?.pageIndex ?? 0) + 1
			);
		}
	}

	// "Synthetic Cements closed at ₹1,284.50 on Friday 9 October, 18.4% higher than a year earlier."
	let priceSentence: string | null = null;
	if (ok && name) {
		const last = ok.last!;
		priceSentence = `${name} closed at ${price(last.value)} on ${longDay(last.day)}`;
		if (ok.yearAgo) {
			const ch = change(last.value, ok.yearAgo.value);
			priceSentence += `, ${percent(Math.abs(ch))} ${ch >= 0 ? 'higher' : 'lower'} than a year earlier`;
		}
		priceSentence += '.';
	}
	const sentence = [priceSentence, business].filter(Boolean).join(' ') || null;
	return { sentence, figures: [close, range, pe, profitFig], epsCell };
}
