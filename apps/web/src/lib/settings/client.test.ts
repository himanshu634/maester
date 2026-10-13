import { describe, expect, it, vi } from 'vitest';
import type { Fetcher } from '$lib/documents/client';
import { connectionsApi } from './client';

function json(status: number, body: unknown): Response {
	return new Response(status === 204 ? null : JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function recording(...answers: Response[]) {
	const calls: { url: string; init?: RequestInit }[] = [];
	const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
		calls.push({ url, init });
		return answers.shift()!;
	}) as unknown as Fetcher;
	return { fetcher, calls };
}

describe('connectionsApi', () => {
	it('lists the connections', async () => {
		const { fetcher, calls } = recording(json(200, { items: [] }));
		await expect(connectionsApi(fetcher).list()).resolves.toEqual({ items: [] });
		expect(calls[0]?.url).toBe('/v1/settings/connections');
	});

	it('sends a Dhan token in a PUT body only, never in the URL', async () => {
		const { fetcher, calls } = recording(json(200, { provider: 'dhan' }));
		await connectionsApi(fetcher).saveDhan({ clientId: '11', accessToken: 'secret-token-abc' });
		expect(calls[0]?.url).toBe('/v1/settings/connections/dhan');
		expect(calls[0]?.url).not.toContain('secret');
		expect(calls[0]?.init?.method).toBe('PUT');
		expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
			clientId: '11',
			accessToken: 'secret-token-abc'
		});
	});

	it('saves a FRED key and removes a connection', async () => {
		const { fetcher, calls } = recording(json(200, { provider: 'fred' }), json(204, null));
		await connectionsApi(fetcher).saveFred({ apiKey: 'k' });
		await connectionsApi(fetcher).remove('fred');
		expect(calls.map((c) => [c.init?.method, c.url])).toEqual([
			['PUT', '/v1/settings/connections/fred'],
			['DELETE', '/v1/settings/connections/fred']
		]);
	});

	it('turns a refusal into an ApiError naming the field', async () => {
		const { fetcher } = recording(
			json(400, {
				error: {
					code: 'VALIDATION_FAILED',
					message: 'request validation failed',
					fields: [{ path: 'accessToken', message: 'Dhan said this token isn’t valid.' }],
					traceId: 't'
				}
			})
		);
		const err = await connectionsApi(fetcher)
			.saveDhan({ clientId: '11', accessToken: 'x' })
			.catch((e: unknown) => e);
		expect(err).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
		expect((err as { names(p: string): boolean }).names('accessToken')).toBe(true);
	});
});
