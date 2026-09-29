import { formatDuration } from "./format";
import { IncidentItemBlock } from "./incident";
import { Layout } from "./layout";
import { en } from "./strings";
import type { ReminderEmailProps } from "./types";

/** FR-23: reminder for incidents still open and not acknowledged. */
export function ReminderEmail(props: ReminderEmailProps) {
	const now = Date.parse(props.now);
	return (
		<Layout
			preview={en.reminder.preview(props.domain, props.items.length)}
			heading={en.reminder.heading(props.domain)}
			intro={en.reminder.intro(props.intervalHours)}
		>
			{props.items.map((item) => (
				<IncidentItemBlock
					key={item.incidentId}
					item={item}
					appUrl={props.appUrl}
					extra={{
						label: en.fields.openFor,
						value: formatDuration(now - Date.parse(item.detectedAt)),
					}}
				/>
			))}
		</Layout>
	);
}
