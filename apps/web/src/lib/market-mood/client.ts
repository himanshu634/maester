/**
 * A small typed client for the market mood routes of the API (apps/api/src/routes/market-mood.ts).
 * Same origin and session cookie as the documents client, whose error handling it reuses.
 */
import { getJson, type Fetcher } from '$lib/documents/client';
import type { MarketMood, ReadingDetail, ReadingKey } from './types';

export function marketMoodApi(fetcher: Fetcher) {
	return {
		mood(): Promise<MarketMood> {
			return getJson(fetcher, '/v1/market-mood');
		},
		reading(key: ReadingKey): Promise<ReadingDetail> {
			return getJson(fetcher, `/v1/market-mood/readings/${encodeURIComponent(key)}`);
		}
	};
}

export type MarketMoodApi = ReturnType<typeof marketMoodApi>;
