import { emailSubject, systemWideOutageSubject } from "@linkwatch/core";
import { createElement, type ReactElement } from "react";
import { render } from "react-email";
import { IncidentEmail } from "./incident";
import { OutageEmail } from "./outage";
import { RecoveryEmail } from "./recovery";
import { ReminderEmail } from "./reminder";
import { en } from "./strings";
import { TestEmail } from "./test-email";
import type {
	IncidentEmailProps,
	OutageEmailProps,
	RecoveryEmailProps,
	ReminderEmailProps,
	TestEmailProps,
} from "./types";

export type RenderedEmail = { subject: string; html: string; text: string };

async function renderBoth(
	subject: string,
	element: ReactElement,
): Promise<RenderedEmail> {
	const [html, text] = await Promise.all([
		render(element),
		render(element, { plainText: true }),
	]);
	return { subject, html, text };
}

/** FR-21, FR-22, FR-24: grouped incident email for one domain. */
export const renderIncidentEmail = (props: IncidentEmailProps) =>
	renderBoth(
		emailSubject("down", props.domain, props.items.length),
		createElement(IncidentEmail, props),
	);

/** FR-21: recovery email for one domain. */
export const renderRecoveryEmail = (props: RecoveryEmailProps) =>
	renderBoth(
		emailSubject("recovery", props.domain, props.items.length),
		createElement(RecoveryEmail, props),
	);

/** FR-23: reminder email for one domain. */
export const renderReminderEmail = (props: ReminderEmailProps) =>
	renderBoth(
		emailSubject("reminder", props.domain, props.items.length),
		createElement(ReminderEmail, props),
	);

/** SRS 5.2 step 5: single admin email for a system-wide outage run. */
export const renderOutageEmail = (props: OutageEmailProps) =>
	renderBoth(
		systemWideOutageSubject(props.failed, props.checked),
		createElement(OutageEmail, props),
	);

/** FR-26: test email from the Settings screen. */
export const renderTestEmail = (props: TestEmailProps) =>
	renderBoth(en.test.subject, createElement(TestEmail, props));
