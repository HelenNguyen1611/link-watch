import type { LinkStatus } from "@linkwatch/core";
import { Group, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";

/** Colour per status: glanceable information, so it keeps colour despite the minimal style. */
const COLORS: Record<LinkStatus, string> = {
	pending: "var(--mantine-color-gray-5)",
	up: "var(--mantine-color-green-7)",
	slow: "var(--mantine-color-yellow-6)",
	dead: "var(--mantine-color-orange-7)",
	down: "var(--mantine-color-red-7)",
	suspect: "var(--mantine-color-grape-6)",
};

/** SRS 5.1: Up / Slow / Dead link / Site down (+ Pending, Suspect) — coloured dot + text. */
export function StatusBadge({ status }: { status: LinkStatus }) {
	const { t } = useTranslation();
	return (
		<Group gap={8} wrap="nowrap">
			<span
				aria-hidden="true"
				style={{
					width: 8,
					height: 8,
					borderRadius: "50%",
					background: COLORS[status],
					flexShrink: 0,
				}}
			/>
			<Text size="sm" fw={500}>
				{t(`status.${status}`)}
			</Text>
		</Group>
	);
}
