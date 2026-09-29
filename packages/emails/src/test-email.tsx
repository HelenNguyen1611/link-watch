import { Text } from "react-email";
import { Layout } from "./layout";
import { en } from "./strings";
import type { TestEmailProps } from "./types";

/** FR-26: test email sent from SCR-08. */
export function TestEmail(props: TestEmailProps) {
	return (
		<Layout
			preview={en.test.preview}
			heading={en.test.heading}
			intro={en.test.intro(props.sender)}
		>
			<Text>{en.test.requestedBy(props.requestedBy)}</Text>
		</Layout>
	);
}
