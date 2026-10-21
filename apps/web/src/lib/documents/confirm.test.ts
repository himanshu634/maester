import { describe, expect, it } from 'vitest';
import { documentsContent as copy } from '$lib/content/documents';
import { ApiError } from './client';
import {
	CONFIRM_SHOWN,
	confirmFailure,
	confirmedAloud,
	confirmRequest,
	confirmRows,
	openerFilled,
	rowsToDraw,
	sectionLede,
	unnamedNotice
} from './confirm';
import { companyOf, fileOf, heldOf } from './testing';

const thirtyOne = [
	heldOf({
		key: 'bse:532999|isin:INE999Z01011|nse:COASTBANK',
		nameAsPrinted: 'Coastline Bank Limited',
		cin: null,
		bseCode: '532999',
		isin: 'INE999Z01011',
		nseSymbol: 'COASTBANK',
		filings: 9,
		files: 26
	}),
	heldOf({ key: 'bse:600000', files: 14 }),
	...Array.from({ length: 29 }, (_, i) =>
		heldOf({ key: `bse:6${String(i + 1).padStart(5, '0')}`, files: 6 })
	)
];

describe('companies to confirm', () => {
	it('rows: four shown, the rest counted, the first Add primary', () => {
		expect(CONFIRM_SHOWN).toBe(4);
		expect(sectionLede(thirtyOne)).toBe(
			'31 companies. Their 214 files wait until you confirm each company, once.'
		);
		const { rows, more } = confirmRows(thirtyOne, [], false);
		expect(rows).toHaveLength(4);
		expect(more).toBe(27);
		expect(rows[0]).toMatchObject({
			title: 'Coastline Bank Limited',
			codes: 'BSE 532999 · NSE COASTBANK · ISIN INE999Z01011',
			counts: '9 filings · 26 files',
			addLabel: 'Add Coastline Bank',
			mode: 'add',
			primary: true
		});
		expect(rows[1].primary).toBe(false);
		expect(copy.confirm.more(27)).toBe('27 more companies');
	});

	it('show all lists every row and counts none more', () => {
		const all = confirmRows(thirtyOne, [], true);
		expect(all.rows).toHaveLength(31);
		expect(all.more).toBe(0);
		expect(all.rows.filter((r) => r.primary)).toHaveLength(1);
	});

	it('the CIN joins the codes when it is printed; with no name the codes are the title', () => {
		const [row] = confirmRows(
			[
				heldOf({
					nameAsPrinted: null,
					cin: 'L12345MH2000PLC123456',
					bseCode: '500999',
					files: 1,
					filings: 1
				})
			],
			[],
			false
		).rows;
		expect(row.codes).toBe('BSE 500999 · CIN L12345MH2000PLC123456');
		expect(row.title).toBe('BSE 500999');
		expect(row.addLabel).toBe('Add this company');
		expect(row.counts).toBe('1 filing · 1 file');
	});

	it('a row that matches a company already added asks which', () => {
		expect(
			confirmRows([heldOf({ matches: ['co-1'] })], [companyOf({ id: 'co-1' })], false).rows[0]
		).toMatchObject({ mode: 'pick', matches: [{ id: 'co-1' }] });
	});

	it('the lede is singular for one company and one file', () => {
		expect(sectionLede([heldOf({ files: 1 })])).toBe(
			'1 company. Its file waits until you confirm it, once.'
		);
	});

	it('the request carries only well-formed identifiers', () => {
		expect(
			confirmRequest(
				heldOf({
					cin: 'not-a-cin',
					bseCode: '532999',
					isin: 'INE999Z01011',
					nseSymbol: 'COASTBANK',
					nameAsPrinted: 'Coastline Bank Limited'
				}),
				{ name: 'Coastline Bank Limited' }
			)
		).toEqual({
			identity: { bseCode: '532999', isin: 'INE999Z01011', nseSymbol: 'COASTBANK' },
			company: {
				new: {
					displayName: 'Coastline Bank Limited',
					country: 'IN',
					bseCode: '532999',
					isin: 'INE999Z01011',
					nseSymbol: 'COASTBANK'
				}
			}
		});
	});

	it('an existing company is chosen by id, and a typed name is trimmed', () => {
		const held = heldOf({ cin: 'L12345MH2000PLC123456', isin: 'bad' });
		expect(confirmRequest(held, { id: 'co-1' })).toEqual({
			identity: { cin: 'L12345MH2000PLC123456' },
			company: { id: 'co-1' }
		});
		expect(confirmRequest(held, { name: '  Meridian Foods  ' }).company).toEqual({
			new: { displayName: 'Meridian Foods', country: 'IN', cin: 'L12345MH2000PLC123456' }
		});
	});

	it('said once confirmed', () => {
		expect(confirmedAloud('Coastline Bank', true, { companyId: 'c', confirmed: 26 })).toBe(
			'Coastline Bank added. Its 26 files carry on.'
		);
		expect(confirmedAloud('Coastline Bank', true, { companyId: 'c', confirmed: 1 })).toBe(
			'Coastline Bank added. Its file carries on.'
		);
		expect(confirmedAloud('Coastline Bank', false, { companyId: 'c', confirmed: 26 })).toBe(
			'26 files confirmed as Coastline Bank.'
		);
		expect(confirmedAloud('Coastline Bank', false, { companyId: 'c', confirmed: 1 })).toBe(
			'1 file confirmed as Coastline Bank.'
		);
		expect(confirmedAloud('Coastline Bank', true, { companyId: 'c', confirmed: 0 })).toBe(
			'Nothing was waiting for this company any more.'
		);
	});

	it('a name clash reloads the companies and opens the picker', () => {
		expect(confirmFailure(new ApiError(409, 'CONFLICT', 'x'))).toEqual({
			message: copy.changeFailed.companyClash,
			reload: true
		});
	});

	it('the other refusals', () => {
		expect(confirmFailure(new ApiError(401, 'UNAUTHENTICATED', 'x'))).toEqual({
			message: copy.changeFailed.signedOut,
			reload: false
		});
		expect(confirmFailure(new ApiError(0, 'NETWORK', 'x'))).toEqual({
			message: copy.changeFailed.offline,
			reload: false
		});
		expect(confirmFailure(new ApiError(400, 'VALIDATION_FAILED', 'x'))).toEqual({
			message: copy.changeFailed.invalid,
			reload: false
		});
		expect(confirmFailure(new ApiError(500, 'INTERNAL', 'x'))).toEqual({
			message: copy.changeFailed.other,
			reload: false
		});
		expect(confirmFailure(new Error('x'))).toEqual({
			message: copy.changeFailed.other,
			reload: false
		});
	});

	it('an unsorted file that prints a name but no code is asked by its name', () => {
		expect(
			unnamedNotice(fileOf({ originalName: 'meridian-q2.pdf', companyNameAsPrinted: null }))
		).toEqual({
			title: 'meridian-q2.pdf: which company is this?',
			detail:
				'Maester couldn’t find the company on the first pages. Say which it is and it carries on.'
		});
		expect(
			unnamedNotice(
				fileOf({
					originalName: 'meridian-q2.pdf',
					companyNameAsPrinted: 'Meridian Foods Limited'
				})
			)
		).toEqual({
			title: 'meridian-q2.pdf: is this Meridian Foods Limited?',
			detail:
				'No company code is printed beside the name, so Maester can’t match it. Add it, or say which of your companies it is.'
		});
		expect(copy.confirm.unnamedAction).toBe('Say which company');
	});

	it('draws no confirm row until the companies have loaded', () => {
		const { rows } = confirmRows([heldOf({ matches: ['co-1'] })], [], false);
		// Without the companies read, a row that matches one reads as an add (the match is not found).
		expect(rows[0].mode).toBe('add');
		expect(rowsToDraw(rows, false)).toEqual([]);
		expect(rowsToDraw(rows, true)).toBe(rows);
	});

	it('one opener is filled, only while there are no rows and its form is closed', () => {
		expect(openerFilled({ rows: 0, index: 0, open: false })).toBe(true);
		expect(openerFilled({ rows: 0, index: 0, open: true })).toBe(false);
		expect(openerFilled({ rows: 0, index: 1, open: false })).toBe(false);
		expect(openerFilled({ rows: 2, index: 0, open: false })).toBe(false);
	});

	it('the words of the section’s own controls', () => {
		expect(copy.confirm.pickerLabel).toBe('Your companies');
		expect(copy.confirm.oneOfMine).toBe('It’s one of mine');
		expect(copy.confirm.saving).toBe('Saving…');
	});
});
