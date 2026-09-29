import type { ReactNode } from "react";
import {
	Body,
	Container,
	Head,
	Heading,
	Hr,
	Html,
	Preview,
	Text,
} from "react-email";
import { en } from "./strings";

const styles = {
	body: {
		backgroundColor: "#f6f7f9",
		fontFamily:
			"-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
		color: "#1f2328",
	},
	container: {
		backgroundColor: "#ffffff",
		margin: "24px auto",
		padding: "24px",
		maxWidth: "600px",
		borderRadius: "8px",
	},
	heading: { fontSize: "20px", margin: "0 0 12px" },
	footer: { fontSize: "12px", color: "#656d76" },
} as const;

export function Layout(props: {
	preview: string;
	heading: string;
	intro: string;
	children: ReactNode;
}) {
	return (
		<Html lang="en">
			<Head />
			<Preview>{props.preview}</Preview>
			<Body style={styles.body}>
				<Container style={styles.container}>
					<Heading as="h1" style={styles.heading}>
						{props.heading}
					</Heading>
					<Text>{props.intro}</Text>
					{props.children}
					<Hr />
					<Text style={styles.footer}>{en.footer}</Text>
				</Container>
			</Body>
		</Html>
	);
}

export const itemStyles = {
	item: {
		borderLeft: "4px solid #cf222e",
		padding: "8px 12px",
		margin: "0 0 12px",
		backgroundColor: "#fff8f8",
	},
	recovered: {
		borderLeft: "4px solid #1a7f37",
		padding: "8px 12px",
		margin: "0 0 12px",
		backgroundColor: "#f6fff8",
	},
	url: { fontWeight: 600, wordBreak: "break-all", margin: "0 0 4px" },
	line: { margin: "0", fontSize: "14px" },
	link: { color: "#0969da" },
} as const;
