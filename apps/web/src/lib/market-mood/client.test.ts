import { describe, expect, it, vi } from 'vitest';
import { ApiError, type Fetcher } from '$lib/documents/client';
import { marketMoodApi } from './client';

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function answering(response: Response | Error) {
	const urls: string[] = [];
	const fetcher = vi.fn(async (url: string) => {
		urls.push(url);
		if (response instanceof Error) throw response;
		return response;
	}) as unknown as Fetcher;
	return { fetcher, urls };
}

describe('marketMoodApi', () => {
	it('reads the mood from /v1/market-mood', async () => {
		const { fetcher, urls } = answering(json(200, { score: 29 }));
		await expect(marketMoodApi(fetcher).mood()).resolves.toEqual({ score: 29 });
		expect(urls).toEqual(['/v1/market-mood']);
	});

	it('reads one reading from /v1/market-mood/readings/<key>', async () => {
		const { fetcher, urls } = answering(json(200, { series: [] }));
		await expect(marketMoodApi(fetcher).reading('india_vix')).resolves.toEqual({ series: [] });
		expect(urls).toEqual(['/v1/market-mood/readings/india_vix']);
	});

	it('turns a refusal into an ApiError with the API code', async () => {
		const { fetcher } = answering(
			json(401, { error: { code: 'UNAUTHENTICATED', message: 'sign in', traceId: 't' } })
		);
		const error = await marketMoodApi(fetcher)
			.mood()
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ApiError);
		expect(error).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
	});

	it('reports a call that never reached the API as NETWORK', async () => {
		const { fetcher } = answering(new TypeError('Failed to fetch'));
		await expect(marketMoodApi(fetcher).reading('us_vix')).rejects.toMatchObject({
			status: 0,
			code: 'NETWORK'
		});
	});
});
