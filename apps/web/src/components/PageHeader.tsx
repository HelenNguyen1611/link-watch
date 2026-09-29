import { Stack, Text, Title } from "@mantine/core";
import type { ReactNode } from "react";

/** Large page title + grey description (minimal style). */
export function PageHeader({
	title,
	description,
	children,
	mb = 48,
}: {
	title: string;
	description?: string;
	children?: ReactNode;
	/** Space below the header; pages with an action right under it use less. */
	mb?: number;
}) {
	return (
		<Stack gap="xs" mb={mb}>
			<Title order={1} style={{ letterSpacing: "-0.01em" }}>
				{title}
			</Title>
			{description && (
				<Text size="lg" c="dimmed" maw={720}>
					{description}
				</Text>
			)}
			{children}
		</Stack>
	);
}
