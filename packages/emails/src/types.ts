import type { CheckErrorType, IncidentType } from "@linkwatch/core";

/** FR-24: one failing link in an incident or reminder email. */
export type IncidentItem = {
	incidentId: string;
	url: string;
	type: IncidentType;
	errorType?: CheckErrorType;
	httpCode?: number;
	/** ISO time the incident was opened (second failed check). */
	detectedAt: string;
	/** FR-33: token of this recipient's "Fixed — check again" button for this link. */
	confirmToken?: string;
};

/** FR-21: one recovered link in a recovery email. */
export type RecoveryItem = {
	incidentId: string;
	url: string;
	/** ISO time of the successful check. */
	recoveredAt: string;
	downtimeMs: number;
	/** FR-37: closed by a verification after this person reported it fixed. */
	fixedBy?: string;
};

type Common = {
	domain: string;
	/** Base URL of the web app, e.g. https://watch.hueai.net */
	appUrl: string;
};

export type IncidentEmailProps = Common & {
	items: IncidentItem[];
	/** FR-33: token of the "all links" button when the email lists several links. */
	groupToken?: string;
};
export type RecoveryEmailProps = Common & { items: RecoveryItem[] };
export type ReminderEmailProps = Common & {
	items: IncidentItem[];
	/** FR-23: reminder interval, shown in the intro. */
	intervalHours: number;
	now: string;
};

/** SRS 5.2 step 5: system-wide outage notice for the admin. */
export type OutageEmailProps = {
	dispatchedAt: string;
	checked: number;
	failed: number;
};

/** FR-26: test email. */
export type TestEmailProps = { sender: string; requestedBy: string };

/** FR-38: sent only to the person who reported the link fixed, after 3 failed checks. */
export type StillFailingEmailProps = Common & {
	url: string;
	incidentId: string;
	claimedAt: string;
	attempts: {
		attempt: number;
		at: string;
		result: string;
		httpCode?: number;
		errorType?: IncidentItem["errorType"];
	}[];
};
