/**
 * FR-28 / FR-29: messages Amazon Cognito sends itself — the invitation (AdminCreateUser,
 * "Resend invite") and the verification code (Forgot password). Cognito fills its placeholders;
 * everything else is fixed at deploy time, so these are plain HTML strings that infra imports.
 * Same look as the SES alerts (theme.ts). Only imports theme.ts, so the CDK app does not load React.
 */
// ".js": infra compiles with NodeNext module resolution.
import { css, hostOf, type Tone } from "./theme.js";

/** Cognito placeholders — each must appear in its body, or the User Pool update is rejected. */
export const COGNITO_USERNAME = "{username}";
export const COGNITO_CODE = "{####}";
/** Cognito's limit for a message body. */
export const COGNITO_EMAIL_MAX_LENGTH = 20_000;

export type CognitoEmailOptions = {
	/** e.g. https://watch.hueai.net */
	appUrl: string;
	/** Address Cognito sends from, so recipients can tell the email is expected. */
	senderAddress: string;
};

const p = (html: string) => `<p style="${css.p}">${html}</p>`;
const row = (label: string, value: string) =>
	`<tr><td style="${css.label}">${label}:</td><td style="${css.value}">${value}</td></tr>`;
const details = (rows: string[]) =>
	`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px"><tr><td style="padding:12px 16px">` +
	`<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join("")}</table></td></tr></table>`;
const button = (href: string, text: string) =>
	`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px"><tr><td><a href="${href}" style="${css.button}">${text}</a></td></tr></table>`;
const notice = (tone: Tone, html: string) =>
	`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px"><tr><td style="${css.notice(tone)}">${html}</td></tr></table>`;
const list = (items: string[]) =>
	`<ul style="margin:0 0 8px;padding-left:18px">${items
		.map(
			(i) =>
				`<li style="margin:0 0 6px;font-size:13px;line-height:20px;color:#656d76">${i}</li>`,
		)
		.join("")}</ul>`;
const step = (n: number, html: string) =>
	`<tr><td style="width:28px;vertical-align:top;padding:4px 0"><span style="display:inline-block;width:20px;height:20px;line-height:20px;border-radius:10px;background:#0f766e;color:#ffffff;font-size:12px;font-weight:600;text-align:center">${n}</span></td>` +
	`<td style="padding:4px 0 8px;font-size:15px;line-height:22px">${html}</td></tr>`;
const code = (value: string) => `<code style="${css.code}">${value}</code>`;

/** Header, badge, heading, body and footer — the frame every LinkWatch email shares. */
function shell(o: {
	title: string;
	host: string;
	badge: { tone: Tone; text: string };
	heading: string;
	body: string;
	footer: string;
}): string {
	return [
		`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${o.title}</title></head>`,
		`<body style="${css.page}">`,
		`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">`,
		`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${css.card}">`,
		`<tr><td style="${css.header}"><span style="${css.product}">LinkWatch</span><span style="${css.host}">&nbsp;·&nbsp;${o.host}</span></td></tr>`,
		`<tr><td style="padding:24px">`,
		`<span style="${css.badge(o.badge.tone)}">${o.badge.text}</span>`,
		`<h1 style="${css.h1}">${o.heading}</h1>`,
		o.body,
		`</td></tr>`,
		`<tr><td style="${css.footer}">${o.footer}</td></tr>`,
		`</table></td></tr></table></body></html>`,
	].join("");
}

/** FR-29: invitation with the temporary password (`validityDays` = User Pool setting). */
export function cognitoInviteEmail(
	o: CognitoEmailOptions & { validityDays: number },
): { subject: string; html: string } {
	const site = o.appUrl.replace(/\/+$/, "");
	const host = hostOf(site);
	const login = `${site}/login/`;
	const days = `${o.validityDays} day${o.validityDays === 1 ? "" : "s"}`;
	const loginLink = `<a href="${login}" style="${css.link}">${host}/login</a>`;
	const body = [
		p(
			"An administrator created a LinkWatch account for you. LinkWatch checks your team's websites on a schedule and emails the right people when a link breaks or a site goes down.",
		),
		details([
			row("Sign-in page", loginLink),
			row("Email", `<strong>${COGNITO_USERNAME}</strong>`),
			row("Temporary password", code(COGNITO_CODE)),
			row("Valid for", `${days} from when this email was sent`),
		]),
		button(login, "Sign in to LinkWatch"),
		`<h2 style="${css.h2}">What to do</h2>`,
		`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px">`,
		step(1, `Open ${loginLink}.`),
		step(
			2,
			"Enter your email and the temporary password above, exactly as shown.",
		),
		step(
			3,
			"Choose your own password: at least 12 characters, with an uppercase letter, a lowercase letter and a number. You then go straight into LinkWatch.",
		),
		`</table>`,
		notice(
			"warning",
			`<strong>The temporary password expires in ${days}</strong> and works only once. If it has expired, or you received several invitations, ask your administrator to <em>resend the invite</em> and use the newest email only.`,
		),
		`<h2 style="${css.h2}">Good to know</h2>`,
		list([
			`Copy the <strong>whole</strong> password, including any symbol at the start or end: some mail apps offer a "Copy code" button that can drop one. If sign-in fails, type it by hand.`,
			`This email is sent by Amazon Cognito, the sign-in service LinkWatch uses, from <strong>${o.senderAddress}</strong>. Always check that the page you sign in on is <strong>${host}</strong>.`,
			"LinkWatch never asks for your password by email, chat or phone. Your administrator chose your role (Admin, Editor or Viewer); you can see it on the Account page after signing in.",
			"Not expecting this? You can ignore this email. The account stays unused, and the temporary password expires on its own.",
		]),
	].join("");
	return {
		subject: "Your LinkWatch invitation and temporary password",
		html: shell({
			title: "LinkWatch invitation",
			host,
			badge: { tone: "info", text: "Invitation" },
			heading: "You have been invited to LinkWatch",
			body,
			footer: `Sent automatically by LinkWatch (${host}) because an administrator invited you. Replies to this address are not read.`,
		}),
	};
}

/**
 * FR-28: verification code — Cognito uses this message for "Forgot password" (and for
 * verifying a changed email address). Reset codes are valid for 1 hour.
 */
export function cognitoVerificationEmail(o: CognitoEmailOptions): {
	subject: string;
	html: string;
} {
	const site = o.appUrl.replace(/\/+$/, "");
	const host = hostOf(site);
	const login = `${site}/login/`;
	const body = [
		p(
			"Someone asked to reset the password of your LinkWatch account. Enter this code on the page where you asked for it, then choose a new password.",
		),
		details([
			row("Verification code", code(COGNITO_CODE)),
			row("Valid for", "1 hour"),
			row(
				"Sign-in page",
				`<a href="${login}" style="${css.link}">${host}/login</a>`,
			),
		]),
		notice(
			"warning",
			"<strong>Did not ask for this?</strong> Ignore this email: your password stays the same, and the code expires on its own. If it keeps happening, tell your administrator.",
		),
		`<h2 style="${css.h2}">Good to know</h2>`,
		list([
			"The code works once. Asked several times? Only the newest code is valid.",
			`This email is sent by Amazon Cognito, the sign-in service LinkWatch uses, from <strong>${o.senderAddress}</strong>. Only enter the code on <strong>${host}</strong>.`,
			"LinkWatch never asks for this code or your password by email, chat or phone.",
		]),
	].join("");
	return {
		subject: "Your LinkWatch verification code",
		html: shell({
			title: "LinkWatch verification code",
			host,
			badge: { tone: "info", text: "Password reset" },
			heading: "Your verification code",
			body,
			footer: `Sent automatically by LinkWatch (${host}) because a password reset was requested for this address. Replies to this address are not read.`,
		}),
	};
}
