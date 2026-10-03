import { formatTime, incidentUrl } from "./format";
import { Details, Hint, ItemCard, Layout, TextLink } from "./layout";
import { en } from "./strings";
import type { StillFailingEmailProps } from "./types";

/** FR-38: the three verification checks failed — only the claimer gets this. */
export function StillFailingEmail(props: StillFailingEmailProps) {
	return (
		<Layout
			preview={en.stillFailing.preview(props.url)}
			tone="danger"
			badge={en.stillFailing.badge}
			heading={en.stillFailing.heading}
			intro={en.stillFailing.intro(props.url)}
			appUrl={props.appUrl}
			footer={en.footer.claimer}
		>
			<ItemCard tone="danger" url={props.url}>
				<Details
					rows={props.attempts.map(
						(a) =>
							[
								en.stillFailing.attempt(a.attempt),
								`${formatTime(a.at)} — ${
									[a.httpCode, a.errorType && en.errorType[a.errorType]]
										.filter(Boolean)
										.join(" · ") || a.result
								}`,
							] as const,
					)}
				/>
				<p style={{ margin: "8px 0 0" }}>
					<TextLink href={incidentUrl(props.appUrl, props.incidentId)}>
						{en.fields.viewIncident}
					</TextLink>
				</p>
			</ItemCard>
			<Hint>{en.stillFailing.onlyYou}</Hint>
		</Layout>
	);
}
