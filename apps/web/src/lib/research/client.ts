/**
 * A small typed client for the Research routes of the API (apps/api/src/routes/research.ts and
 * the /file redirect in documents.ts). Same origin, session cookie, `fetch` passed in for tests.
 */
import { getJson, type Fetcher } from '$lib/documents/client';
import type { CompanyFinancials, CompanyStock, ResearchCompany } from './types';

export function researchApi(fetcher: Fetcher, workspaceId: string) {
	const base = `/v1/workspaces/${encodeURIComponent(workspaceId)}`;
	const company = (id: string) => `${base}/companies/${encodeURIComponent(id)}`;
	return {
		companies: () => getJson<{ items: ResearchCompany[] }>(fetcher, `${base}/research/companies`),
		financials: (id: string) => getJson<CompanyFinancials>(fetcher, `${company(id)}/financials`),
		stock: (id: string) => getJson<CompanyStock>(fetcher, `${company(id)}/stock`),
		/** The stored PDF at a page: the API redirects and the browser keeps "#page=". Counted from 1. */
		pageHref: (documentId: string, pageIndex: number) =>
			`${base}/documents/${encodeURIComponent(documentId)}/file#page=${pageIndex + 1}`
	};
}

export type ResearchApi = ReturnType<typeof researchApi>;
