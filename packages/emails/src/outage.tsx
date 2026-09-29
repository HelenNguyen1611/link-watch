import { Text } from "react-email";
import { formatTime } from "./format";
import { Layout } from "./layout";
import { en } from "./strings";
import type { OutageEmailProps } from "./types";

/** SRS 5.2 step 5: single admin email when most links failed in one run. */
export function OutageEmail(props: OutageEmailProps) {
	return (
		<Layout
			preview={en.outage.preview(props.failed, props.checked)}
			heading={en.outage.heading}
			intro={en.outage.intro(props.failed, props.checked)}
		>
			<Text>
				{en.outage.run}: {formatTime(props.dispatchedAt)}
			</Text>
			<Text>{en.outage.advice}</Text>
		</Layout>
	);
}
