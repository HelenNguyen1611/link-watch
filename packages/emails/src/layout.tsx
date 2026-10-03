import type { CSSProperties, ReactNode } from "react";
import { Body, Head, Html, Link, Preview } from "react-email";
import { css, hostOf, type Tone, theme, tones } from "./theme";

/** `css.*` strings (shared with the Cognito HTML emails) → React style objects. */
export function sx(style: string): CSSProperties {
	const out: Record<string, string> = {};
	for (const decl of style.split(";")) {
		const i = decl.indexOf(":");
		if (i < 0) continue;
		const key = decl
			.slice(0, i)
			.trim()
			.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
		out[key] = decl.slice(i + 1).trim();
	}
	return out as CSSProperties;
}

const table = {
	role: "presentation",
	width: "100%",
	cellPadding: 0,
	cellSpacing: 0,
} as const;

/**
 * The frame every LinkWatch email shares (same as the Cognito invitation): product header,
 * status badge, heading, intro, content and a footer saying why the recipient gets it.
 */
export function Layout(props: {
	preview: string;
	tone: Tone;
	badge: string;
	heading: string;
	intro: ReactNode;
	/** Web app URL for the header host and the footer link; omitted → product name only. */
	appUrl?: string;
	footer: string;
	children: ReactNode;
}) {
	const host = props.appUrl ? hostOf(props.appUrl) : undefined;
	return (
		<Html lang="en">
			<Head />
			<Preview>{props.preview}</Preview>
			<Body style={sx(css.page)}>
				<table {...table}>
					<tbody>
						<tr>
							<td align="center" style={{ padding: "24px 12px" }}>
								<table {...table} style={sx(css.card)}>
									<tbody>
										<tr>
											<td style={sx(css.header)}>
												<p style={{ margin: 0 }}>
													<span style={sx(css.product)}>LinkWatch</span>
													{host && <span style={sx(css.host)}> · {host}</span>}
												</p>
											</td>
										</tr>
										<tr>
											<td style={{ padding: "24px" }}>
												<p style={{ margin: 0 }}>
													<span style={sx(css.badge(props.tone))}>
														{props.badge}
													</span>
												</p>
												<h1 style={sx(css.h1)}>{props.heading}</h1>
												<p style={sx(css.p)}>{props.intro}</p>
												{props.children}
											</td>
										</tr>
										<tr>
											<td style={sx(css.footer)}>
												{props.footer}
												{props.appUrl && (
													<>
														{" "}
														<Link href={props.appUrl} style={sx(css.link)}>
															Open LinkWatch
														</Link>
													</>
												)}
											</td>
										</tr>
									</tbody>
								</table>
							</td>
						</tr>
					</tbody>
				</table>
			</Body>
		</Html>
	);
}

/**
 * Label / value rows, the same grid as the invitation's sign-in details. One paragraph per
 * row (not a table) so the plain-text part reads "Label: value" on its own line.
 */
export function Details(props: {
	rows: (readonly [string, ReactNode] | false | undefined)[];
}) {
	return (
		<>
			{props.rows
				.filter((r): r is readonly [string, ReactNode] => Boolean(r))
				.map(([label, value]) => (
					<p
						key={label}
						style={{ margin: "0 0 4px", fontSize: "15px", lineHeight: "22px" }}
					>
						<span
							style={{
								display: "inline-block",
								minWidth: "130px",
								fontSize: "13px",
								color: theme.muted,
							}}
						>
							{label}:
						</span>{" "}
						{value}
					</p>
				))}
		</>
	);
}

/** One link in an alert: tone-coloured left border, URL, details and actions. */
export function ItemCard(props: {
	tone: Tone;
	url: string;
	children: ReactNode;
}) {
	return (
		<table {...table} style={{ margin: "0 0 14px" }}>
			<tbody>
				<tr>
					<td
						style={{
							borderLeft: `4px solid ${tones[props.tone].fg}`,
							background: tones[props.tone].bg,
							borderRadius: "0 6px 6px 0",
							padding: "12px 16px",
						}}
					>
						<p
							style={{
								margin: "0 0 8px",
								fontSize: "15px",
								fontWeight: 600,
								wordBreak: "break-all",
							}}
						>
							{props.url}
						</p>
						{props.children}
					</td>
				</tr>
			</tbody>
		</table>
	);
}

/** Primary action, same button as the invitation's "Sign in to LinkWatch". */
export function PrimaryButton(props: { href: string; children: ReactNode }) {
	return (
		<table
			role="presentation"
			cellPadding={0}
			cellSpacing={0}
			style={{ margin: "10px 0 4px" }}
		>
			<tbody>
				<tr>
					<td>
						<a href={props.href} style={sx(css.button)}>
							{props.children}
						</a>
					</td>
				</tr>
			</tbody>
		</table>
	);
}

export function TextLink(props: { href: string; children: ReactNode }) {
	return (
		<Link href={props.href} style={{ ...sx(css.link), fontSize: "14px" }}>
			{props.children}
		</Link>
	);
}

/** Highlighted box (warning, info…) like the invitation's expiry notice. */
export function Notice(props: { tone: Tone; children: ReactNode }) {
	return (
		<table {...table} style={{ margin: "4px 0 16px" }}>
			<tbody>
				<tr>
					<td style={sx(css.notice(props.tone))}>{props.children}</td>
				</tr>
			</tbody>
		</table>
	);
}

/** Small grey note under the content. */
export function Hint(props: { children: ReactNode }) {
	return (
		<p
			style={{
				margin: "12px 0 0",
				fontSize: "13px",
				lineHeight: "20px",
				color: theme.muted,
			}}
		>
			{props.children}
		</p>
	);
}
