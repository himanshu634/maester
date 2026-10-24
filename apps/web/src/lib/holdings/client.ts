/**
 * A small typed client for Holdings (apps/api/src/routes/brokers.ts). A broker's credentials go
 * only in a PUT body over the same-origin proxy: never in a URL, storage or a log.
 */
import { getJson, send, type Fetcher } from '$lib/documents/client';
import type { BrokerAccount, BrokerSummary, HoldingsSnapshot } from './types';

async function json<T>(fetcher: Fetcher, url: string, init: RequestInit): Promise<T> {
	const response = await send(fetcher, url, init);
	return response.json() as Promise<T>;
}

export function holdingsApi(fetcher: Fetcher, workspaceId: string) {
	const base = `/v1/workspaces/${workspaceId}`;
	const broker = (id: string) => `${base}/brokers/${encodeURIComponent(id)}`;
	return {
		brokers(): Promise<{ items: BrokerSummary[] }> {
			return getJson(fetcher, '/v1/brokers');
		},
		snapshot(): Promise<HoldingsSnapshot> {
			return getJson(fetcher, `${base}/holdings`);
		},
		save(id: string, credentials: Record<string, string>): Promise<BrokerAccount> {
			return json(fetcher, broker(id), {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ credentials })
			});
		},
		/** Where to send the browser to sign in on the broker's own page. */
		async signInUrl(id: string): Promise<string> {
			return (await json<{ url: string }>(fetcher, `${broker(id)}/sign-in`, { method: 'POST' }))
				.url;
		},
		/** A direct sign-in (Groww): Maester signs in with the saved key and reads at once. */
		session(id: string): Promise<BrokerAccount> {
			return json(fetcher, `${broker(id)}/session`, { method: 'POST' });
		},
		read(id: string): Promise<BrokerAccount> {
			return json(fetcher, `${broker(id)}/read`, { method: 'POST' });
		},
		async remove(id: string): Promise<void> {
			await send(fetcher, broker(id), { method: 'DELETE' });
		}
	};
}

export type HoldingsApi = ReturnType<typeof holdingsApi>;
