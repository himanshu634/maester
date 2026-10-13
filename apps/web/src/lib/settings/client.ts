/**
 * A small typed client for Settings → Connections (apps/api/src/routes/connections.ts). The secret
 * goes only in a PUT body over the same-origin proxy: never in a URL, storage or a log.
 */
import { getJson, send, type Fetcher } from '$lib/documents/client';
import type {
	Connection,
	ConnectionList,
	ConnectionProvider,
	SaveDhanConnectionRequest,
	SaveFredConnectionRequest
} from './types';

const BASE = '/v1/settings/connections';

async function put<T>(fetcher: Fetcher, url: string, body: unknown): Promise<T> {
	const response = await send(fetcher, url, {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	return response.json() as Promise<T>;
}

export function connectionsApi(fetcher: Fetcher) {
	return {
		list(): Promise<ConnectionList> {
			return getJson(fetcher, BASE);
		},
		saveDhan(req: SaveDhanConnectionRequest): Promise<Connection> {
			return put(fetcher, `${BASE}/dhan`, req);
		},
		saveFred(req: SaveFredConnectionRequest): Promise<Connection> {
			return put(fetcher, `${BASE}/fred`, req);
		},
		async remove(provider: ConnectionProvider): Promise<void> {
			await send(fetcher, `${BASE}/${provider}`, { method: 'DELETE' });
		}
	};
}

export type ConnectionsApi = ReturnType<typeof connectionsApi>;
