/**
 * FR-29: the invitation email Amazon Cognito sends on AdminCreateUser (and "Resend invite").
 * Cognito fills `{username}` and `{####}` (the temporary password); everything else is fixed at
 * deploy time, so this is a plain HTML string (no React) that infra can import.
 * Kept self-contained: no imports, so the CDK app does not load react-email.
 */

/** Cognito placeholders — both must appear in the body, or the User Pool update is rejected. */
export const COGNITO_USERNAME = "{username}";
export const COGNITO_CODE = "{####}";
/** Cognito's limit for an invitation message body. */
export const COGNITO_EMAIL_MAX_LENGTH = 20_000;

export type InviteEmailOptions = {
	/** e.g. https://watch.hueai.net */
	appUrl: string;
	/** Temporary password validity of the User Pool (infra/lib/api-stack.ts). */
	validityDays: number;
	/** Address Cognito sends from, so recipients can tell the email is expected. */
	senderAddress: string;
};

const color = {
	brand: "#0f766e",
	text: "#1f2328",
	muted: "#656d76",
	border: "#d0d7de",
	panel: "#f6f8fa",
	warn: "#9a6700",
	warnBg: "#fff8c5",
};

export function cognitoInviteEmail(o: InviteEmailOptions): {
	subject: string;
	html: string;
} {
	const site = o.appUrl.replace(/\/+$/, "");
	const host = site.replace(/^https?:\/\//, "");
	const login = `${site}/login/`;
	const days = `${o.validityDays} day${o.validityDays === 1 ? "" : "s"}`;
	const p = (text: string, style = "") =>
		`<p style="margin:0 0 12px;font-size:15px;line-height:22px;${style}">${text}</p>`;
	const row = (label: string, value: string) =>
		`<tr><td style="padding:6px 0;font-size:13px;color:${color.muted};width:150px;vertical-align:top">${label}</td>` +
		`<td style="padding:6px 0;font-size:15px;vertical-align:top">${value}</td></tr>`;
	const step = (n: number, text: string) =>
		`<tr><td style="width:28px;vertical-align:top;padding:4px 0"><span style="display:inline-block;width:20px;height:20px;line-height:20px;border-radius:10px;background:${color.brand};color:#ffffff;font-size:12px;font-weight:600;text-align:center">${n}</span></td>` +
		`<td style="padding:4px 0 8px;font-size:15px;line-height:22px">${text}</td></tr>`;
	const li = (text: string) =>
		`<li style="margin:0 0 6px;font-size:13px;line-height:20px;color:${color.muted}">${text}</li>`;

	const html = [
		`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LinkWatch invitation</title></head>`,
		`<body style="margin:0;padding:0;background:${color.panel};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${color.text}">`,
		`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${color.panel}"><tr><td align="center" style="padding:24px 12px">`,
		`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid ${color.border};border-radius:8px">`,
		// Header
		`<tr><td style="padding:20px 24px;border-bottom:3px solid ${color.brand}">`,
		`<span style="font-size:18px;font-weight:700;color:${color.brand}">LinkWatch</span>`,
		`<span style="font-size:13px;color:${color.muted}">&nbsp;·&nbsp;${host}</span></td></tr>`,
		`<tr><td style="padding:24px">`,
		`<h1 style="margin:0 0 12px;font-size:20px;line-height:28px">You have been invited to LinkWatch</h1>`,
		p(
			`An administrator created a LinkWatch account for you. LinkWatch checks your team's websites on a schedule and emails the right people when a link breaks or a site goes down.`,
		),
		// Sign-in details
		`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;background:${color.panel};border:1px solid ${color.border};border-radius:6px"><tr><td style="padding:12px 16px">`,
		`<table role="presentation" width="100%" cellpadding="0" cellspacing="0">`,
		row(
			"Sign-in page",
			`<a href="${login}" style="color:${color.brand}">${host}/login</a>`,
		),
		row("Email", `<strong>${COGNITO_USERNAME}</strong>`),
		row(
			"Temporary password",
			`<code style="display:inline-block;padding:4px 8px;background:#ffffff;border:1px solid ${color.border};border-radius:4px;font-family:SFMono-Regular,Consolas,'Liberation Mono',Menlo,monospace;font-size:16px;letter-spacing:1px">${COGNITO_CODE}</code>`,
		),
		row("Valid for", `${days} from when this email was sent`),
		`</table></td></tr></table>`,
		// Button
		`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px"><tr><td style="border-radius:6px;background:${color.brand}">`,
		`<a href="${login}" style="display:inline-block;padding:10px 20px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none">Sign in to LinkWatch</a>`,
		`</td></tr></table>`,
		// Steps
		`<h2 style="margin:0 0 8px;font-size:16px">What to do</h2>`,
		`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px">`,
		step(
			1,
			`Open <a href="${login}" style="color:${color.brand}">${host}/login</a>.`,
		),
		step(
			2,
			`Enter your email and the temporary password above, exactly as shown.`,
		),
		step(
			3,
			`Choose your own password: at least 12 characters, with an uppercase letter, a lowercase letter and a number. You then go straight into LinkWatch.`,
		),
		`</table>`,
		// Expiry warning
		`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:${color.warnBg};border-radius:6px"><tr><td style="padding:10px 14px;font-size:14px;line-height:20px;color:${color.warn}">`,
		`<strong>The temporary password expires in ${days}</strong> and works only once. If it has expired, or you received several invitations, ask your administrator to <em>resend the invite</em> and use the newest email only.`,
		`</td></tr></table>`,
		// Notes
		`<h2 style="margin:0 0 8px;font-size:16px">Good to know</h2>`,
		`<ul style="margin:0 0 8px;padding-left:18px">`,
		li(
			`Copy the <strong>whole</strong> password, including any symbol at the start or end: some mail apps offer a "Copy code" button that can drop one. If sign-in fails, type it by hand.`,
		),
		li(
			`This email is sent by Amazon Cognito, the sign-in service LinkWatch uses, from <strong>${o.senderAddress}</strong>. Always check that the page you sign in on is <strong>${host}</strong>.`,
		),
		li(
			`LinkWatch never asks for your password by email, chat or phone. Your administrator chose your role (Admin, Editor or Viewer); you can see it on the Account page after signing in.`,
		),
		li(
			`Not expecting this? You can ignore this email. The account stays unused, and the temporary password expires on its own.`,
		),
		`</ul>`,
		`</td></tr>`,
		// Footer
		`<tr><td style="padding:14px 24px;border-top:1px solid ${color.border};font-size:12px;line-height:18px;color:${color.muted}">`,
		`Sent automatically by LinkWatch (${host}) because an administrator invited you. Replies to this address are not read.`,
		`</td></tr></table>`,
		`</td></tr></table></body></html>`,
	].join("");

	return {
		subject: "Your LinkWatch invitation and temporary password",
		html,
	};
}
