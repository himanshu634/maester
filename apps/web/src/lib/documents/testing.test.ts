import { describe, expect, it } from 'vitest';
import {
	abandoned,
	basisOf,
	fileOf,
	pdfNotNeeded,
	pipe,
	readWith,
	rejected,
	stmt,
	xbrlDone,
	xbrlFailed
} from './testing';

describe('the builders', () => {
	it('pipe overlays fields and keeps the rest, arrays whole', () => {
		const p = pipe({ numbers: { state: 'failed', warnings: ['XBRL_NIL'] }, text: { ahead: 2 } });
		expect(p.numbers).toMatchObject({ state: 'failed', source: 'pdf', warnings: ['XBRL_NIL'] });
		expect(p.text).toMatchObject({ state: 'done', ahead: 2, pages: 10 });
		expect(pipe().numbers.warnings).toEqual([]);
	});

	it('fileOf numbers its ids and names the file after them', () => {
		const a = fileOf();
		const b = fileOf({ format: 'xbrl' });
		expect(a.originalName).toBe(`${a.documentId}.pdf`);
		expect(b.originalName).toBe(`${b.documentId}.xml`);
		expect(b.documentId).not.toBe(a.documentId);
		expect(fileOf({ documentId: 'x', originalName: 'ar.pdf' })).toMatchObject({
			documentId: 'x',
			originalName: 'ar.pdf'
		});
	});

	it('the named files say what they are', () => {
		expect(xbrlDone('x1', 'standalone')).toMatchObject({ format: 'xbrl', basis: 'standalone' });
		expect(xbrlFailed('x2').pipeline.numbers).toMatchObject({ source: 'xbrl', state: 'failed' });
		expect(pdfNotNeeded('p1', ['x1']).pipeline.numbers).toMatchObject({
			state: 'not_needed',
			coveredByXbrl: ['x1']
		});
		expect(rejected('r1', 'TOO_LARGE')).toMatchObject({
			state: 'rejected',
			rejectionCode: 'TOO_LARGE'
		});
		expect(rejected('r1', 'TOO_LARGE').pipeline).toMatchObject({
			stored: 'failed',
			identified: 'waiting'
		});
		expect(abandoned('a1').pipeline).toMatchObject({
			stored: 'now',
			identified: 'waiting',
			text: { state: 'waiting', ahead: null }
		});
	});

	it('stmt, basisOf and readWith build the rest', () => {
		expect(stmt()).toMatchObject({ statement: 'income_statement', source: 'xbrl', reason: null });
		expect(basisOf('standalone', [stmt()])).toEqual({ basis: 'standalone', statements: [stmt()] });
		expect(readWith()).toEqual({ companies: [], held: [], unsorted: [] });
	});
});
