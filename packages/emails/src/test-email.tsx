import { Details, Layout, Notice } from "./layout";
import { en } from "./strings";
import type { TestEmailProps } from "./types";

/** FR-26: test email sent from SCR-08. */
export function TestEmail(props: TestEmailProps) {
	return (
		<Layout
			preview={en.test.preview}
			tone="info"
			badge={en.test.badge}
			heading={en.test.heading}
			intro={en.test.intro(props.sender)}
			{...(props.appUrl && { appUrl: props.appUrl })}
			footer={en.footer.test}
		>
			<Details
				rows={[
					[en.test.senderLabel, props.sender],
					[en.test.requestedByLabel, props.requestedBy],
				]}
			/>
			<Notice tone="success">{en.test.works}</Notice>
		</Layout>
	);
}
