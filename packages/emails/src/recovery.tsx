import { Link, Section, Text } from "react-email";
import { formatDuration, formatTime, incidentUrl } from "./format";
import { itemStyles, Layout } from "./layout";
import { en } from "./strings";
import type { RecoveryEmailProps } from "./types";

/** FR-21: recovery email with the downtime of each link (AC-07). */
export function RecoveryEmail({ domain, items, appUrl }: RecoveryEmailProps) {
	return (
		<Layout
			preview={en.recovery.preview(domain, items.length)}
			heading={en.recovery.heading(domain)}
			intro={en.recovery.intro}
		>
			{items.map((item) => (
				<Section key={item.incidentId} style={itemStyles.recovered}>
					<Text style={itemStyles.url}>{item.url}</Text>
					<Text style={itemStyles.line}>
						{en.fields.downtime}: {formatDuration(item.downtimeMs)}
					</Text>
					<Text style={itemStyles.line}>
						{en.fields.recoveredAt}: {formatTime(item.recoveredAt)}
					</Text>
					{item.fixedBy && (
						<Text style={itemStyles.line}>
							{en.fixedBy}: {item.fixedBy}
						</Text>
					)}
					<Text style={itemStyles.line}>
						<Link
							href={incidentUrl(appUrl, item.incidentId)}
							style={itemStyles.link}
						>
							{en.fields.viewIncident}
						</Link>
					</Text>
				</Section>
			))}
		</Layout>
	);
}
