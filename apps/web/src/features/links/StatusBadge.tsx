import type { LinkStatus } from "@linkwatch/core";
import { Group, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { STATUS_STYLE } from "./status-style";

/** SRS 5.1: Up / Slow / Dead link / Site down (+ Pending, Suspect) — coloured icon + text. */
export function StatusBadge({ status }: { status: LinkStatus }) {
	const { t } = useTranslation();
	const { color, icon, Icon } = STATUS_STYLE[status];
	return (
		<Group gap={6} wrap="nowrap">
			<Text
				component="span"
				c={color}
				lh={0}
				data-testid="status-icon"
				data-icon={icon}
			>
				<Icon size={18} />
			</Text>
			<Text size="sm" fw={500} c={color} style={{ whiteSpace: "nowrap" }}>
				{t(`status.${status}`)}
			</Text>
		</Group>
	);
}
