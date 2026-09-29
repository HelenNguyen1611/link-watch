import type { CheckErrorType, IncidentType } from "@linkwatch/core";

/** Text shown in emails (English only, 29/09/2026 decision). */
export const en = {
	incident: {
		preview: (domain: string, count: number) =>
			`${count === 1 ? "1 link is" : `${count} links are`} failing on ${domain}`,
		heading: (domain: string) => `Problems detected on ${domain}`,
		intro: "LinkWatch confirmed the following failures (two checks in a row):",
	},
	recovery: {
		preview: (domain: string, count: number) =>
			`${count === 1 ? "1 link is" : `${count} links are`} working again on ${domain}`,
		heading: (domain: string) => `Back up on ${domain}`,
		intro: "The following links are working again:",
	},
	reminder: {
		preview: (domain: string, count: number) =>
			`Still failing on ${domain}: ${count === 1 ? "1 link" : `${count} links`}`,
		heading: (domain: string) => `Still failing on ${domain}`,
		intro: (hours: number) =>
			`These incidents are still open and nobody has acknowledged them in the last ${hours} hours:`,
	},
	outage: {
		preview: (failed: number, checked: number) =>
			`${failed} of ${checked} links failed in one run`,
		heading: "Possible network problem on the LinkWatch side",
		intro: (failed: number, checked: number) =>
			`${failed} of ${checked} links failed in the same run. This usually means LinkWatch itself could not reach the internet, so no alerts were sent to domain recipients.`,
		run: "Run started",
		advice:
			"Check the LinkWatch Checker logs. Incidents confirmed during this run stay open and are closed silently when the links respond again.",
	},
	fields: {
		type: "Type",
		error: "Error",
		httpCode: "HTTP code",
		detectedAt: "Detected",
		recoveredAt: "Recovered",
		downtime: "Downtime",
		openFor: "Open for",
		viewIncident: "View incident",
	},
	incidentType: {
		dead: "Dead link",
		down: "Site down",
	} satisfies Record<IncidentType, string>,
	errorType: {
		dns: "Domain name does not resolve (DNS)",
		timeout: "Timed out",
		connection_refused: "Connection refused",
		ssl: "SSL/TLS error",
		network: "Network error",
		http_5xx: "Server error (5xx)",
		http_4xx: "Client error (4xx)",
		unexpected_status: "Unexpected HTTP status",
		too_many_redirects: "Too many redirects",
		keyword_missing: "Required keyword not found",
		blocked_private_address: "Blocked: private network address",
	} satisfies Record<CheckErrorType, string>,
	footer:
		"You receive this email because you are a recipient for this domain or link in LinkWatch.",
} as const;
