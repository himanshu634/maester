/**
 * The API's research shapes, as the Research pages read them. apps/web is a standalone project
 * and cannot import @maester/contracts, so these mirror packages/contracts/src/research.ts
 * (and Company from company.ts). When a contract changes, change it here too.
 */
import type {
	ClassificationKind,
	Company,
	FactSpan,
	IntakeState,
	ReportingBasis,
	StatementKind,
	XbrlPdfNotChecked
} from '$lib/documents/types';

export type CellStatus = 'value' | 'dash' | 'unparsed' | 'missing';

export interface CellCheck {
	role: 'subject' | 'component' | 'none';
	status: 'passed' | 'failed' | 'not_checked' | null;
	/** A line carries only its subtotal's check; the balance identity is on total assets alone. */
	checkType: 'subtotal' | 'balance_identity' | null;
	subjectLabel: string | null;
	expected: string | null;
	actual: string | null;
}

/** The page variant of the API's CellSource: a figure read from a page of a PDF. */
export interface PageSource {
	kind: 'page';
	documentId: string;
	/** 0-based; pages are shown counted from 1. */
	pageIndex: number;
	pageCount: number;
	textLayerMatch: boolean | null;
}

/**
 * Whether an XBRL fact's value was found on its results PDF's statement pages (the API's
 * `XbrlInPdf`). `pdfDocumentId` is null with no PDF stored; `pageIndex` is the 0-based page the
 * value was found on; `statementPages` are the 0-based pages of the fact's statement and basis.
 */
export interface XbrlInPdf {
	status: 'passed' | 'failed' | 'not_checked';
	pdfDocumentId: string | null;
	pageIndex: number | null;
	statementPages: number[];
	reason: XbrlPdfNotChecked | null;
}

/** The XBRL variant of the API's CellSource: a figure read from an element of an XBRL file, which has no pages. */
export interface XbrlSource {
	kind: 'xbrl';
	documentId: string;
	/** The XBRL file's name. */
	originalName: string;
	element: string;
	/** Carried by the API; never shown. */
	contextId: string;
	/** The fact's `decimals` as written: "INF" or an integer. */
	decimals: string | null;
	/** True when the fact is `xsi:nil`: the cell is unparsed, never zero. */
	nil: boolean;
	periodStart: string | null;
	span: FactSpan | null;
	inPdf: XbrlInPdf;
}

export type CellSource = PageSource | XbrlSource;

/** The page variant of the API's Restated: what another filing printed, on a page. */
export interface PageRestated {
	kind: 'page';
	documentId: string;
	filingPeriodEnd: string | null;
	pageIndex: number;
	value: string | null;
	printed: string;
}

/** The XBRL variant of the API's Restated: what another filing's XBRL element held. */
export interface XbrlRestated {
	kind: 'xbrl';
	documentId: string;
	filingPeriodEnd: string | null;
	element: string;
	value: string | null;
	printed: string;
}

export type Restated = PageRestated | XbrlRestated;

export interface FinancialCell {
	status: CellStatus;
	value: string | null;
	printed: string | null;
	factId: string | null;
	revisionId: string | null;
	source: CellSource | null;
	check: CellCheck;
	restated: Restated | null;
}

export interface FinancialRow {
	key: string;
	section: string;
	label: string;
	isSubtotal: boolean;
	perShare: boolean;
	cells: FinancialCell[];
}

export interface FinancialColumn {
	periodEnd: string;
	periodLabel: string;
	documentId: string;
	filingPeriodEnd: string | null;
}

export interface TableUnit {
	label: string | null;
	scale: string | null;
	currency: string | null;
}

export interface StatementTable {
	statement: StatementKind;
	basis: ReportingBasis;
	unit: TableUnit;
	/** Empty when the statement was read but none of its figures has a date. */
	columns: FinancialColumn[];
	rows: FinancialRow[];
	unplaced: number;
	leftOut: { documentId: string; reason: 'other_currency' | 'other_unit' }[];
}

export interface CompanyFiling {
	documentId: string;
	originalName: string;
	kind: ClassificationKind | null;
	periodEnd: string | null;
	intakeState: IntakeState | null;
	counted: boolean;
}

export interface CompanyFinancials {
	company: Company;
	filings: CompanyFiling[];
	tables: StatementTable[];
}

export interface StockPoint {
	day: string;
	value: number;
}

export interface CompanyStock {
	state: 'ok' | 'no_symbol' | 'not_connected' | 'not_tracked';
	symbol: string | null;
	source: string | null;
	last: StockPoint | null;
	previous: StockPoint | null;
	yearAgo: StockPoint | null;
	low: StockPoint | null;
	high: StockPoint | null;
	series: StockPoint[];
}

export interface ResearchCompany {
	company: Company;
	annualReportsRead: number;
	latestPeriodEnd: string | null;
	reading: number;
	failed: number;
}
