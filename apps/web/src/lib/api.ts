import type {
	LinkInputRaw,
	LinkPage,
	LinkView,
	SettingsInput,
	SettingsView,
} from "@linkwatch/core";
import { notifyUnauthorized } from "./auth";

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
	/** FR-28: Cognito ID token (refreshed by Amplify); null when signed out. */
	getToken: () => Promise<string | null>;
	/** Called on 401 (expired or revoked session); defaults to the app-wide sign-out event. */
	onUnauthorized?: () => void;
	fetch?: typeof fetch;
};

export type TestEmailResult = { status: "sent"; to: string };

/** Typed API client sharing schemas with the backend (@linkwatch/core). */
export function createApi(opts: ApiOptions) {
	const doFetch =
		opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

	async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
		const headers = new Headers(init.headers);
		const token = await opts.getToken();
		if (token) headers.set("authorization", `Bearer ${token}`);
		if (init.body) headers.set("content-type", "application/json");
		const res = await doFetch(`${opts.baseUrl}/api${path}`, {
			...init,
			headers,
		});
		if (res.status === 204) return undefined as T;
		const body = await res.json().catch(() => ({}));
		if (res.status === 401) (opts.onUnauthorized ?? notifyUnauthorized)();
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
		/** FR-20, FR-23, FR-26: effective email settings (stored values + deployment defaults). */
		getSettings: () => call<SettingsView>("/settings"),
		updateSettings: (input: SettingsInput) =>
			call<SettingsView>("/settings", {
				method: "PATCH",
				body: JSON.stringify(input),
			}),
		/** FR-26: sends a test email; `to` defaults to the signed-in user. A SES failure is a 502 ApiError. */
		sendTestEmail: (to?: string) =>
			call<TestEmailResult>("/settings/test-email", {
				method: "POST",
				body: JSON.stringify(to ? { to } : {}),
			}),
	};
}

export type Api = ReturnType<typeof createApi>;

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

/** Signed-out client; `AuthProvider` provides one that sends the ID token. */
export const api = createApi({ baseUrl: API_BASE, getToken: async () => null });
