/**
 * The one Better Auth client. Created on first use in the browser, never during
 * prerendering: every route reads the session in onMount.
 */
import { createAuthClient } from 'better-auth/svelte';

type AuthClient = ReturnType<typeof createAuthClient>;
let client: AuthClient | undefined;

export function authClient(): AuthClient {
	client ??= createAuthClient({ baseURL: window.location.origin });
	return client;
}
