import { vi } from "vitest";
import type { Api } from "@/lib/api";

/**
 * Every API method as a `vi.fn()` that fails loudly when a test calls something it did not
 * stub. Tests spread it and override what they use: `{ ...stubApi(), listLinks: vi.fn(...) }`.
 */
export function stubApi(): Api {
	const methods = [
		"listLinks",
		"createLink",
		"deleteLink",
		"getSnapshot",
		"freshLinks",
		"updateLink",
		"bulkLinks",
		"previewImport",
		"commitImport",
		"exportCsv",
		"getLink",
		"linkChecks",
		"linkUptime",
		"linkIncidents",
		"checkNow",
		"listIncidents",
		"getIncident",
		"ackIncident",
		"getSettings",
		"updateSettings",
		"sendTestEmail",
	] as const satisfies readonly (keyof Api)[];
	return Object.fromEntries(
		methods.map((m) => [
			m,
			vi.fn(async () => {
				throw new Error(`API method not stubbed in this test: ${m}`);
			}),
		]),
	) as unknown as Api;
}
