import { Link, Section, Text } from "react-email";
import { formatTime, incidentUrl } from "./format";
import { itemStyles, Layout } from "./layout";
import { en } from "./strings";
import type { StillFailingEmailProps } from "./types";

/** FR-38: the three verification checks failed — only the claimer gets this. */
export function StillFailingEmail(props: StillFailingEmailProps) {
	return (
		<Layout
			preview={en.stillFailing.preview(props.url)}
			heading={en.stillFailing.heading}
			intro={en.stillFailing.intro(props.url)}
		>
			<Section style={itemStyles.item}>
				<Text style={itemStyles.url}>{props.url}</Text>
				{props.attempts.map((a) => (
					<Text key={a.attempt} style={itemStyles.line}>
						{en.stillFailing.attempt(a.attempt)} ({formatTime(a.at)}):{" "}
						{[a.httpCode, a.errorType && en.errorType[a.errorType]]
							.filter(Boolean)
							.join(" · ") || a.result}
					</Text>
				))}
				<Text style={itemStyles.line}>
					<Link
						href={incidentUrl(props.appUrl, props.incidentId)}
						style={itemStyles.link}
					>
						{en.fields.viewIncident}
					</Link>
				</Text>
			</Section>
			<Text style={itemStyles.hint}>{en.stillFailing.onlyYou}</Text>
		</Layout>
	);
}
