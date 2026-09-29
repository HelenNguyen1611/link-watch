import {
	API_KEY_HEADER,
	type LinkInputRaw,
	type LinkPage,
	type LinkView,
} from "@linkwatch/core";
import { getApiKey } from "./api-key";

export class ApiError extends Error {
	constructor(
		readonly status: number,
		readonly body: { error?: string; message?: string; [k: string]: unknown },
	) {
		super(`API ${status}: ${body.error ?? "error"}`);
		this.name = "ApiError";
	}
}

export type ApiOptions = {
	/** "" = same origin (production via CloudFront /api/*). Local: NEXT_PUBLIC_API_BASE=http://localhost:8787. */
	baseUrl: string;
	getApiKey: () => string | null;
	fetch?: typeof fetch;
};

/** Typed API client sharing schemas with the backend (@linkwatch/core). */
export function createApi(opts: ApiOptions) {
	const doFetch =
		opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

	async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
		const headers = new Headers(init.headers);
		const key = opts.getApiKey();
		if (key) headers.set(API_KEY_HEADER, key);
		if (init.body) headers.set("content-type", "application/json");
		const res = await doFetch(`${opts.baseUrl}/api${path}`, {
			...init,
			headers,
		});
		if (res.status === 204) return undefined as T;
		const body = await res.json().catch(() => ({}));
		if (!res.ok) throw new ApiError(res.status, body);
		return body as T;
	}

	return {
		listLinks: ({ cursor }: { cursor?: string | null } = {}) => {
			const q = new URLSearchParams({ limit: "100" });
			if (cursor) q.set("cursor", cursor);
			return call<LinkPage>(`/links?${q}`);
		},
		createLink: (input: LinkInputRaw) =>
			call<LinkView>("/links", { method: "POST", body: JSON.stringify(input) }),
		deleteLink: (id: string) =>
			call<void>(`/links/${encodeURIComponent(id)}`, { method: "DELETE" }),
	};
}

export type Api = ReturnType<typeof createApi>;

export const api = createApi({
	baseUrl: process.env.NEXT_PUBLIC_API_BASE ?? "",
	getApiKey,
});
