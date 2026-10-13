/** Links into the Research pages. Kept apart from view.ts so the tested modules never import SvelteKit. */
import { resolve } from '$app/paths';

/** The company page: prerendered once, so the company travels in the query. */
export function companyHref(id: string): string {
	return `${resolve('/terminal/research/company')}?id=${encodeURIComponent(id)}`;
}
