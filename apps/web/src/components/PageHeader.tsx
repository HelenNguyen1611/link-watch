import { Stack, Text, Title } from "@mantine/core";
import type { ReactNode } from "react";

/** Tiêu đề trang lớn + mô tả xám (phong cách tối giản). */
export function PageHeader({
	title,
	description,
	children,
}: {
	title: string;
	description?: string;
	children?: ReactNode;
}) {
	return (
		<Stack gap="xs" mb={48}>
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
