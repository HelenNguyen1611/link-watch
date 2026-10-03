/**
 * One look for every LinkWatch email — the SES alerts (react-email) and the Cognito
 * invitation / verification messages (plain HTML strings). No imports: infra loads it too.
 */
export const theme = {
	brand: "#0f766e",
	text: "#1f2328",
	muted: "#656d76",
	border: "#d0d7de",
	page: "#f6f8fa",
	card: "#ffffff",
	font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
	mono: "SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace",
} as const;

/** Status colour of an email: the badge, the item cards' left border and background. */
export type Tone = "danger" | "success" | "warning" | "info";

export const tones: Record<Tone, { fg: string; bg: string }> = {
	danger: { fg: "#cf222e", bg: "#fff5f5" },
	success: { fg: "#1a7f37", bg: "#f2fbf4" },
	warning: { fg: "#9a6700", bg: "#fff8c5" },
	info: { fg: "#0969da", bg: "#eef6ff" },
};

/** Host shown next to the product name, e.g. "watch.hueai.net". */
export const hostOf = (appUrl: string) =>
	appUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");

/** Inline styles shared by both renderers (CSS strings for HTML, objects for React). */
export const css = {
	page: `margin:0;padding:0;background:${theme.page};font-family:${theme.font};color:${theme.text}`,
	card: `max-width:600px;background:${theme.card};border:1px solid ${theme.border};border-radius:8px`,
	header: `padding:20px 24px;border-bottom:3px solid ${theme.brand}`,
	product: `font-size:18px;font-weight:700;color:${theme.brand}`,
	host: `font-size:13px;color:${theme.muted}`,
	badge: (t: Tone) =>
		`display:inline-block;margin:0 0 10px;padding:2px 10px;border-radius:12px;background:${tones[t].bg};color:${tones[t].fg};font-size:12px;font-weight:600;letter-spacing:.3px;text-transform:uppercase`,
	h1: "margin:0 0 12px;font-size:20px;line-height:28px",
	h2: "margin:0 0 8px;font-size:16px",
	p: "margin:0 0 12px;font-size:15px;line-height:22px",
	label: `padding:4px 0;font-size:13px;color:${theme.muted};width:140px;vertical-align:top`,
	value: "padding:4px 0;font-size:15px;vertical-align:top",
	button: `display:inline-block;padding:10px 20px;border-radius:6px;background:${theme.brand};color:#ffffff;font-size:15px;font-weight:600;text-decoration:none`,
	link: `color:${theme.brand}`,
	notice: (t: Tone) =>
		`padding:10px 14px;border-radius:6px;background:${tones[t].bg};color:${tones[t].fg};font-size:14px;line-height:20px`,
	footer: `padding:14px 24px;border-top:1px solid ${theme.border};font-size:12px;line-height:18px;color:${theme.muted}`,
	code: `display:inline-block;padding:4px 8px;background:#ffffff;border:1px solid ${theme.border};border-radius:4px;font-family:${theme.mono};font-size:16px;letter-spacing:1px`,
} as const;
