/** Links into the Research pages. Kept apart from view.ts so the tested modules never import SvelteKit. */
import { resolve } from '$app/paths';

/**
 * The company page: prerendered once, so the company travels in the query. Built from the
 * Research route plus "/company" (trailingSlash is "never") because resolve() only takes routes
 * that exist, and the company route arrives with the page itself.
 */
export function companyHref(id: string): string {
	return `${resolve('/terminal/research')}/company?id=${encodeURIComponent(id)}`;
}
