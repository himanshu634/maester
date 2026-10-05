/**
 * A small typed client for the document routes of the API (apps/api/src/routes/documents.ts,
 * classification.ts, companies.ts and me.ts). Same origin: the web server proxies /v1/ and
 * /dev/ to the API, and the session cookie goes with every call. `fetch` is passed in, so the
 * tests can answer for the API.
 */
import type {
	ChangeClassificationRequest,
	ClassificationChanged,
	Company,
	CreateUploadResponse,
	DocumentClassification,
	DocumentRecord,
	ErrorCode,
	FieldError,
	FinalizeResponse,
	Job,
	Me,
	Page
} from './types';

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** How many documents the Earlier list reads: the first page. */
export const DOCUMENT_PAGE = 25;
/** Companies offered in the company picker. The API's largest page. */
export const COMPANY_PAGE = 100;

/** An API answer that was not a success, or a call that never reached the API (`NETWORK`). */
export class ApiError extends Error {
	constructor(
		readonly status: number,
		readonly code: ErrorCode | 'NETWORK',
		message: string,
		readonly fields: FieldError[] = []
	) {
		super(message);
		this.name = 'ApiError';
	}

	/** True when a field error names `path`, as the API's 409s do to say which clash it was. */
	names(path: string): boolean {
		return this.fields.some((field) => field.path === path);
	}
}

const BY_STATUS: Record<number, ErrorCode> = {
	400: 'VALIDATION_FAILED',
	401: 'UNAUTHENTICATED',
	403: 'FORBIDDEN',
	404: 'NOT_FOUND',
	409: 'CONFLICT',
	413: 'UPLOAD_TOO_LARGE',
	415: 'UNSUPPORTED_MEDIA_TYPE',
	429: 'RATE_LIMITED'
};

async function toError(response: Response): Promise<ApiError> {
	let body: unknown = null;
	try {
		body = await response.json();
	} catch {
		// Not the API's envelope (a proxy page, a blob store refusal): fall back to the status.
	}
	const error = (body as { error?: { code?: string; message?: string; fields?: FieldError[] } })
		?.error;
	const code = (error?.code as ErrorCode | undefined) ?? BY_STATUS[response.status] ?? 'INTERNAL';
	return new ApiError(
		response.status,
		code,
		error?.message ?? `HTTP ${response.status}`,
		error?.fields
	);
}

async function send(fetcher: Fetcher, url: string, init?: RequestInit): Promise<Response> {
	let response: Response;
	try {
		response = await fetcher(url, init);
	} catch (cause) {
		throw new ApiError(0, 'NETWORK', cause instanceof Error ? cause.message : 'network error');
	}
	if (!response.ok) throw await toError(response);
	return response;
}

async function getJson<T>(fetcher: Fetcher, url: string): Promise<T> {
	return (await send(fetcher, url)).json() as Promise<T>;
}

async function postJson<T>(fetcher: Fetcher, url: string, body?: unknown): Promise<T> {
	const init: RequestInit = { method: 'POST' };
	if (body !== undefined) {
		init.headers = { 'content-type': 'application/json' };
		init.body = JSON.stringify(body);
	}
	return (await send(fetcher, url, init)).json() as Promise<T>;
}

/** Who is signed in and their workspaces. The page works in the first one. */
export function readMe(fetcher: Fetcher): Promise<Me> {
	return getJson<Me>(fetcher, '/v1/me');
}

export interface UploadHooks {
	/** Called once the API has a record of the file, before its bytes are sent. */
	onCreated?: (document: DocumentRecord) => void;
}

export function documentsApi(fetcher: Fetcher, workspaceId: string) {
	const base = `/v1/workspaces/${encodeURIComponent(workspaceId)}`;
	const doc = (id: string) => `${base}/documents/${encodeURIComponent(id)}`;

	return {
		listDocuments(): Promise<Page<DocumentRecord>> {
			return getJson(fetcher, `${base}/documents?limit=${DOCUMENT_PAGE}`);
		},

		getDocument(id: string): Promise<DocumentRecord> {
			return getJson(fetcher, doc(id));
		},

		/** The current answers about what the document is, or null before it has been identified. */
		async getClassification(id: string): Promise<DocumentClassification | null> {
			try {
				return await getJson<DocumentClassification>(fetcher, `${doc(id)}/classification`);
			} catch (error) {
				if (error instanceof ApiError && error.status === 404) return null;
				throw error;
			}
		},

		changeClassification(
			id: string,
			change: ChangeClassificationRequest
		): Promise<ClassificationChanged> {
			return postJson(fetcher, `${doc(id)}/classification`, change);
		},

		/** Work out what it is again. */
		classify(id: string): Promise<{ job: Job }> {
			return postJson(fetcher, `${doc(id)}/classify`);
		},

		/** Read the statements again. */
		extract(id: string): Promise<{ job: Job }> {
			return postJson(fetcher, `${doc(id)}/extract`);
		},

		listCompanies(): Promise<Page<Company>> {
			return getJson(fetcher, `${base}/companies?limit=${COMPANY_PAGE}`);
		},

		/**
		 * Add a file: ask the API for somewhere to put it, send the bytes there, then tell the API
		 * they have arrived, which starts the checks. Each step throws an ApiError when refused.
		 */
		async upload(file: File, hooks: UploadHooks = {}): Promise<FinalizeResponse> {
			const created = await postJson<CreateUploadResponse>(fetcher, `${base}/documents/uploads`, {
				originalName: file.name,
				size: file.size,
				mimeType: 'application/pdf'
			});
			hooks.onCreated?.(created.document);
			// Content-Length is the browser's to set; passing it on is at best ignored.
			const headers = Object.fromEntries(
				Object.entries(created.upload.headers).filter(
					([name]) => name.toLowerCase() !== 'content-length'
				)
			);
			await send(fetcher, created.upload.url, {
				method: created.upload.method,
				headers,
				body: file
			});
			return postJson<FinalizeResponse>(fetcher, `${doc(created.document.id)}/finalize`);
		}
	};
}

export type DocumentsApi = ReturnType<typeof documentsApi>;
