import { describe, expect, it, vi } from 'vitest';
import type { Fetcher } from '$lib/documents/client';
import { researchApi } from './client';

const WS = '11111111-2222-4333-8444-555555555555';
const CO = '66666666-7777-4888-9999-000000000000';

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

describe('researchApi', () => {
	it('reads the list, the financials and the stock under the workspace', async () => {
		const calls: string[] = [];
		const fetcher = vi.fn(async (url: string) => {
			calls.push(url);
			return json(200, {});
		}) as unknown as Fetcher;
		const api = researchApi(fetcher, WS);
		await api.companies();
		await api.financials(CO);
		await api.stock(CO);
		expect(calls).toEqual([
			`/v1/workspaces/${WS}/research/companies`,
			`/v1/workspaces/${WS}/companies/${CO}/financials`,
			`/v1/workspaces/${WS}/companies/${CO}/stock`
		]);
	});

	it('links to the PDF at a page counted from 1', () => {
		const api = researchApi((() => Promise.reject()) as unknown as Fetcher, WS);
		expect(api.pageHref(CO, 212)).toBe(`/v1/workspaces/${WS}/documents/${CO}/file#page=213`);
	});
});
