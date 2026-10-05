import { describe, expect, it, vi } from 'vitest';
import { ApiError, documentsApi, readMe, type Fetcher } from './client';

const WS = 'c729f393-599e-4f14-9c6f-5aefc028967f';
const DOC = 'b6870653-73b4-44a4-a5b4-e5e410f4944e';

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function envelope(code: string, message: string, fields?: { path: string; message: string }[]) {
	return { error: { code, message, ...(fields ? { fields } : {}), traceId: 't-1' } };
}

/** A fetch that answers each call in turn and remembers what it was asked. */
function scripted(...answers: (Response | Error)[]) {
	const calls: { url: string; init: RequestInit | undefined }[] = [];
	const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
		calls.push({ url, init });
		const next = answers.shift();
		if (!next) throw new Error(`unexpected call to ${url}`);
		if (next instanceof Error) throw next;
		return next;
	}) as unknown as Fetcher;
	return { fetcher, calls };
}

describe('readMe', () => {
	it('reads /v1/me', async () => {
		const { fetcher, calls } = scripted(
			json(200, { user: { id: 'u', name: 'A', email: 'a@example.com' }, workspaces: [{ id: WS }] })
		);
		const me = await readMe(fetcher);
		expect(me.workspaces[0].id).toBe(WS);
		expect(calls[0].url).toBe('/v1/me');
	});
});

describe('documentsApi', () => {
	it('lists documents and companies under the workspace', async () => {
		const { fetcher, calls } = scripted(
			json(200, { items: [], nextCursor: null }),
			json(200, { items: [], nextCursor: null })
		);
		const api = documentsApi(fetcher, WS);
		await api.listDocuments();
		await api.listCompanies();
		expect(calls.map((c) => c.url)).toEqual([
			`/v1/workspaces/${WS}/documents?limit=25`,
			`/v1/workspaces/${WS}/companies?limit=100`
		]);
	});

	it('reads one company', async () => {
		const { fetcher, calls } = scripted(
			json(200, { id: 'co-1', displayName: 'Synthetic Cements' })
		);
		const company = await documentsApi(fetcher, WS).getCompany('co-1');
		expect(company.displayName).toBe('Synthetic Cements');
		expect(calls[0].url).toBe(`/v1/workspaces/${WS}/companies/co-1`);
	});

	it('reads one document', async () => {
		const { fetcher, calls } = scripted(json(200, { id: DOC }));
		const doc = await documentsApi(fetcher, WS).getDocument(DOC);
		expect(doc.id).toBe(DOC);
		expect(calls[0].url).toBe(`/v1/workspaces/${WS}/documents/${DOC}`);
	});

	it('answers null for a classification that does not exist yet', async () => {
		const { fetcher } = scripted(
			json(404, envelope('NOT_FOUND', 'document has not been identified yet'))
		);
		expect(await documentsApi(fetcher, WS).getClassification(DOC)).toBeNull();
	});

	it('posts a change with the classification it was based on', async () => {
		const { fetcher, calls } = scripted(
			json(200, { document: {}, classification: {}, evidence: [] })
		);
		await documentsApi(fetcher, WS).changeClassification(DOC, {
			basedOn: 'c-1',
			company: { new: { displayName: 'Synthetic Cements Limited', country: 'IN' } }
		});
		expect(calls[0].url).toBe(`/v1/workspaces/${WS}/documents/${DOC}/classification`);
		expect(calls[0].init?.method).toBe('POST');
		expect(new Headers(calls[0].init?.headers).get('content-type')).toBe('application/json');
		expect(JSON.parse(String(calls[0].init?.body))).toEqual({
			basedOn: 'c-1',
			company: { new: { displayName: 'Synthetic Cements Limited', country: 'IN' } }
		});
	});

	it('starts identification and reading again', async () => {
		const { fetcher, calls } = scripted(json(202, { job: {} }), json(202, { job: {} }));
		const api = documentsApi(fetcher, WS);
		await api.classify(DOC);
		await api.extract(DOC);
		expect(calls.map((c) => [c.init?.method, c.url])).toEqual([
			['POST', `/v1/workspaces/${WS}/documents/${DOC}/classify`],
			['POST', `/v1/workspaces/${WS}/documents/${DOC}/extract`]
		]);
	});

	it('maps a 409 with its fields to an ApiError', async () => {
		const { fetcher } = scripted(
			json(
				409,
				envelope('CONFLICT', 'the answers changed', [{ path: 'basedOn', message: 'not current' }])
			)
		);
		const error = await documentsApi(fetcher, WS)
			.changeClassification(DOC, { basedOn: 'old', kind: 'other' })
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ApiError);
		expect(error).toMatchObject({ status: 409, code: 'CONFLICT' });
		expect((error as ApiError).fields).toEqual([{ path: 'basedOn', message: 'not current' }]);
	});

	it('maps a 400 to VALIDATION_FAILED', async () => {
		const { fetcher } = scripted(json(400, envelope('VALIDATION_FAILED', 'nothing changed')));
		await expect(
			documentsApi(fetcher, WS).changeClassification(DOC, { basedOn: 'c-1', kind: 'other' })
		).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED', message: 'nothing changed' });
	});

	it('names a failure with no envelope by its status, and a dropped connection as offline', async () => {
		const { fetcher } = scripted(
			new Response('<html>bad gateway</html>', { status: 502 }),
			new TypeError('Failed to fetch')
		);
		const api = documentsApi(fetcher, WS);
		await expect(api.listDocuments()).rejects.toMatchObject({ status: 502, code: 'INTERNAL' });
		await expect(api.listDocuments()).rejects.toMatchObject({ status: 0, code: 'NETWORK' });
	});
});

describe('upload', () => {
	const file = new File([new Uint8Array([37, 80, 68, 70, 45])], 'ar.pdf', {
		type: 'application/pdf'
	});
	const target = {
		method: 'PUT',
		url: 'http://localhost:5175/dev/blobs/x/original.pdf?signature=s',
		headers: { 'Content-Type': 'application/pdf', 'Content-Length': '5' },
		expiresAt: '2026-10-05T10:00:00Z'
	};

	it('creates the upload, sends the bytes, then finalizes', async () => {
		const { fetcher, calls } = scripted(
			json(201, { document: { id: DOC }, upload: target }),
			new Response(null, { status: 200 }),
			json(200, { document: { id: DOC, state: 'uploaded' }, job: { id: 'j' } })
		);
		const created: string[] = [];
		const done = await documentsApi(fetcher, WS).upload(file, {
			onCreated: (doc) => created.push(doc.id)
		});
		expect(done.document.state).toBe('uploaded');
		expect(created).toEqual([DOC]);
		expect(calls[0].url).toBe(`/v1/workspaces/${WS}/documents/uploads`);
		expect(JSON.parse(String(calls[0].init?.body))).toEqual({
			originalName: 'ar.pdf',
			size: 5,
			mimeType: 'application/pdf'
		});
		expect(calls[1].url).toBe(target.url);
		expect(calls[1].init?.method).toBe('PUT');
		expect(calls[1].init?.body).toBe(file);
		// The browser sets Content-Length itself; only the content type is passed on.
		const headers = new Headers(calls[1].init?.headers);
		expect(headers.get('content-type')).toBe('application/pdf');
		expect(headers.has('content-length')).toBe(false);
		expect(calls[2].url).toBe(`/v1/workspaces/${WS}/documents/${DOC}/finalize`);
		expect(calls[2].init?.method).toBe('POST');
	});

	it('reports a file the API finds too large as UPLOAD_TOO_LARGE', async () => {
		const { fetcher, calls } = scripted(
			json(413, envelope('UPLOAD_TOO_LARGE', 'uploads are limited to 52428800 bytes'))
		);
		await expect(documentsApi(fetcher, WS).upload(file)).rejects.toMatchObject({
			status: 413,
			code: 'UPLOAD_TOO_LARGE'
		});
		expect(calls).toHaveLength(1);
	});

	it('stops when the bytes are refused, without finalizing', async () => {
		const { fetcher, calls } = scripted(
			json(201, { document: { id: DOC }, upload: target }),
			new Response('signature expired', { status: 403 })
		);
		await expect(documentsApi(fetcher, WS).upload(file)).rejects.toMatchObject({ status: 403 });
		expect(calls).toHaveLength(2);
	});
});
