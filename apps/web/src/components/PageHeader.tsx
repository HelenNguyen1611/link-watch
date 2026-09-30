import { Flex, Stack, Text, Title } from "@mantine/core";
import type { ReactNode } from "react";

/** Header text is 80% of the theme sizes, so the header takes less of the first screen. */
const TITLE_SIZE = "calc(var(--mantine-h1-font-size) * 0.8)";
const DESCRIPTION_SIZE = "calc(var(--mantine-font-size-lg) * 0.8)";

/**
 * Page title + grey description (minimal style), with an optional `action` on the right.
 * The row wraps: an action that needs the full width (e.g. an opened form) drops below.
 */
export function PageHeader({
	title,
	description,
	action,
	children,
	mb = 48,
}: {
	title: string;
	description?: string;
	/** Shown to the right of the title and description. */
	action?: ReactNode;
	children?: ReactNode;
	/** Space below the header; pages with an action right under it use less. */
	mb?: number;
}) {
	return (
		<Flex wrap="wrap" align="center" columnGap="xl" rowGap="md" mb={mb}>
			<Stack gap={4} style={{ flex: "1 1 auto", minWidth: 0 }}>
				<Title order={1} fz={TITLE_SIZE} style={{ letterSpacing: "-0.01em" }}>
					{title}
				</Title>
				{description && (
					<Text fz={DESCRIPTION_SIZE} c="dimmed" maw={720}>
						{description}
					</Text>
				)}
				{children}
			</Stack>
			{action}
		</Flex>
	);
}
