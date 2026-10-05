import type {
	CheckNowInput,
	CheckNowResult,
	CheckView,
	DomainSummary,
	DomainUpdateRaw,
	IncidentDetail,
	IncidentPage,
	IncidentView,
	LinkInputRaw,
	LinkPage,
	LinkUpdateRaw,
	LinkView,
	RecipientView,
	ScheduleRuleInput,
	ScheduleView,
	SettingsInput,
	SettingsView,
	UptimeSummary,
	UserInvite,
	UserUpdate,
	UserView,
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

export type DomainDetailView = DomainSummary & { uptimeDays: UptimeSummary };

/** FR-39: verification progress of one incident. */
export type ClaimProgressDto = {
	claimedAt: string;
	outcome: "pending" | "fixed" | "still_failing";
	done: boolean;
	total: number;
	attempts: {
		attempt: number;
		at: string;
		result: string;
		httpCode?: number;
		errorType?: string;
	}[];
	byEmail: string;
	channel: "email" | "app";
	note?: string;
};
export type ClaimViewDto = {
	incident: IncidentView;
	progress?: ClaimProgressDto;
	decision?: "started" | "in_progress" | "recovered";
};
export type TokenClaimView =
	| { status: "expired" }
	| { status: "recovered"; items: ClaimViewDto[] }
	| { status: "open"; items: ClaimViewDto[]; recipient: string };

export type LinkSnapshotView = {
	generatedAt: string;
	items: LinkView[];
	stored: boolean;
};

export type ImportRowView = {
	line: number;
	url: string;
	status: "valid" | "duplicate" | "error";
	error?:
		| "invalid_url"
		| "invalid_field"
		| "duplicate_in_file"
		| "duplicate_existing";
	field?: string;
};
export type ImportPreviewView = {
	rows: ImportRowView[];
	summary: { valid: number; duplicate: number; error: number };
};
export type ImportCommitView = {
	created: { line: number; id: string; url: string; domain: string }[];
	rejected: ImportRowView[];
};

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
		/** Step 19b: every link for the list screen (rebuilt after each Dispatcher tick). */
		getSnapshot: () => call<LinkSnapshotView>("/links/snapshot"),
		/** Step 19b: current rows of links the screen is watching (≤ 100). */
		freshLinks: (keys: { domain: string; id: string }[]) =>
			call<{ items: LinkView[] }>("/links/fresh", {
				method: "POST",
				body: JSON.stringify(keys),
			}),
		/** FR-04: partial edit. */
		updateLink: (id: string, input: LinkUpdateRaw) =>
			call<LinkView>(`/links/${encodeURIComponent(id)}`, {
				method: "PATCH",
				body: JSON.stringify(input),
			}),
		/** FR-04: pause / resume / delete up to 100 links. */
		bulkLinks: (action: "pause" | "resume" | "delete", ids: string[]) =>
			call<{ updated: string[]; notFound: string[] }>("/links/bulk", {
				method: "POST",
				body: JSON.stringify({ action, ids }),
			}),
		/** FR-03: import preview and commit (≤ 25 rows per commit call). */
		previewImport: (text: string) =>
			call<ImportPreviewView>("/links/import/preview", {
				method: "POST",
				body: JSON.stringify({ text }),
			}),
		commitImport: (text: string) =>
			call<ImportCommitView>("/links/import", {
				method: "POST",
				body: JSON.stringify({ text }),
			}),
		/** FR-05: CSV export (text; the page turns it into a download). */
		exportCsv: async () => {
			const headers = new Headers();
			const token = await opts.getToken();
			if (token) headers.set("authorization", `Bearer ${token}`);
			const res = await doFetch(`${opts.baseUrl}/api/links/export.csv`, {
				headers,
			});
			if (res.status === 401) (opts.onUnauthorized ?? notifyUnauthorized)();
			if (!res.ok) throw new ApiError(res.status, {});
			return res.text();
		},
		/** FR-11 / FR-12: schedule templates ("default" = system default). */
		listSchedules: () => call<{ items: ScheduleView[] }>("/schedules"),
		createSchedule: (input: { name: string; rule: ScheduleRuleInput }) =>
			call<ScheduleView>("/schedules", {
				method: "POST",
				body: JSON.stringify(input),
			}),
		updateSchedule: (
			id: string,
			input: { name?: string; rule?: ScheduleRuleInput },
		) =>
			call<ScheduleView>(`/schedules/${encodeURIComponent(id)}`, {
				method: "PATCH",
				body: JSON.stringify(input),
			}),
		deleteSchedule: (id: string) =>
			call<void>(`/schedules/${encodeURIComponent(id)}`, { method: "DELETE" }),
		/** FR-08 / FR-10: domain overview, one domain, settings. */
		listDomains: () =>
			call<{ items: DomainSummary[]; generatedAt: string }>("/domains"),
		getDomain: (name: string) =>
			call<DomainDetailView>(`/domains/${encodeURIComponent(name)}`),
		updateDomain: (name: string, input: DomainUpdateRaw) =>
			call<DomainDetailView>(`/domains/${encodeURIComponent(name)}`, {
				method: "PATCH",
				body: JSON.stringify(input),
			}),
		/** FR-20: recipients of a domain or a link. */
		listRecipients: (scope: "DOMAIN" | "LINK", target: string) =>
			call<{ items: RecipientView[] }>(
				`/recipients?${new URLSearchParams({ scope, target })}`,
			),
		addRecipient: (input: {
			scope: "DOMAIN" | "LINK";
			target: string;
			email: string;
			name?: string;
		}) =>
			call<RecipientView>("/recipients", {
				method: "POST",
				body: JSON.stringify(input),
			}),
		removeRecipient: (
			scope: "DOMAIN" | "LINK",
			target: string,
			email: string,
		) =>
			call<void>(
				`/recipients?${new URLSearchParams({ scope, target, email })}`,
				{
					method: "DELETE",
				},
			),
		/** FR-18: one link and its history. */
		getLink: (id: string) => call<LinkView>(`/links/${encodeURIComponent(id)}`),
		linkChecks: (id: string, limit = 100) =>
			call<{ items: CheckView[] }>(
				`/links/${encodeURIComponent(id)}/checks?limit=${limit}`,
			),
		linkUptime: (id: string, days = 30) =>
			call<UptimeSummary>(
				`/links/${encodeURIComponent(id)}/uptime?days=${days}`,
			),
		linkIncidents: (id: string) =>
			call<{ items: IncidentView[] }>(
				`/links/${encodeURIComponent(id)}/incidents`,
			),
		/** FR-16: queue an immediate check. */
		checkNow: (input: CheckNowInput) =>
			call<CheckNowResult>("/links/check-now", {
				method: "POST",
				body: JSON.stringify(input),
			}),
		/** FR-35 / FR-39: confirmation page (token, no sign-in). GET only reads. */
		getPublicClaim: (token: string) =>
			call<TokenClaimView>(`/public/claims?${new URLSearchParams({ token })}`),
		submitPublicClaim: (input: {
			token: string;
			note?: string;
			incidentIds?: string[];
		}) =>
			call<TokenClaimView>("/public/claims", {
				method: "POST",
				body: JSON.stringify(input),
			}),
		/** FR-41: report incidents as fixed from the app. */
		resolveClaims: (incidentIds: string[], note?: string) =>
			call<{ items: ClaimViewDto[] }>("/incidents/resolve-claim", {
				method: "POST",
				body: JSON.stringify({ incidentIds, ...(note?.trim() && { note }) }),
			}),
		/** FR-19: incidents. Ids contain `@` and `:` → always URL-encoded. */
		listIncidents: ({
			state,
			cursor,
		}: {
			state: "active" | "closed";
			cursor?: string | null;
		}) => {
			const q = new URLSearchParams({ state });
			if (cursor) q.set("cursor", cursor);
			return call<IncidentPage>(`/incidents?${q}`);
		},
		getIncident: (id: string) =>
			call<IncidentDetail>(`/incidents/${encodeURIComponent(id)}`),
		ackIncident: (id: string, note?: string) =>
			call<IncidentView>(`/incidents/${encodeURIComponent(id)}/ack`, {
				method: "POST",
				body: JSON.stringify(note === undefined ? {} : { note }),
			}),
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
		/** FR-29 (admin only): accounts in the Cognito User Pool with their role. */
		listUsers: () => call<{ items: UserView[] }>("/users"),
		/** FR-29: Cognito emails a temporary password; an existing account is a 409 ApiError. */
		inviteUser: (input: UserInvite) =>
			call<UserView>("/users", { method: "POST", body: JSON.stringify(input) }),
		/** FR-29: change role / enable / disable; `self_change` and `last_admin` are 409. */
		updateUser: (email: string, input: UserUpdate) =>
			call<UserView>(`/users/${encodeURIComponent(email)}`, {
				method: "PATCH",
				body: JSON.stringify(input),
			}),
		resendInvite: (email: string) =>
			call<{ status: "sent"; to: string }>(
				`/users/${encodeURIComponent(email)}/resend-invite`,
				{ method: "POST" },
			),
		deleteUser: (email: string) =>
			call<void>(`/users/${encodeURIComponent(email)}`, { method: "DELETE" }),
		/** FR-20: every alert to this user; `not_active` and `disabled` are 409. */
		setUserAlerts: (email: string, on: boolean) =>
			call<{ email: string; alerts: boolean }>(
				`/users/${encodeURIComponent(email)}/alerts`,
				{ method: "PUT", body: JSON.stringify({ on }) },
			),
	};
}

export type Api = ReturnType<typeof createApi>;

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

/** Signed-out client; `AuthProvider` provides one that sends the ID token. */
export const api = createApi({ baseUrl: API_BASE, getToken: async () => null });
