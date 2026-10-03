import { formatTime } from "./format";
import { Details, Layout, Notice } from "./layout";
import { en } from "./strings";
import type { OutageEmailProps } from "./types";

/** SRS 5.2 step 5: single admin email when most links failed in one run. */
export function OutageEmail(props: OutageEmailProps) {
	return (
		<Layout
			preview={en.outage.preview(props.failed, props.checked)}
			tone="warning"
			badge={en.outage.badge}
			heading={en.outage.heading}
			intro={en.outage.intro(props.failed, props.checked)}
			{...(props.appUrl && { appUrl: props.appUrl })}
			footer={en.footer.admin}
		>
			<Details
				rows={[
					[en.outage.run, formatTime(props.dispatchedAt)],
					[en.outage.failedLinks, `${props.failed} / ${props.checked}`],
				]}
			/>
			<Notice tone="warning">{en.outage.advice}</Notice>
		</Layout>
	);
}
