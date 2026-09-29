import type { LinkStatus } from "@linkwatch/core";
import { Badge } from "@mantine/core";
import { useTranslation } from "react-i18next";

const COLORS: Record<LinkStatus, string> = {
	pending: "gray",
	up: "green",
	slow: "yellow",
	dead: "orange",
	down: "red",
	suspect: "grape",
};

/** SRS 5.1: Hoạt động / Chậm / Link chết / Site down (+ Chờ kiểm tra, Nghi ngờ). */
export function StatusBadge({ status }: { status: LinkStatus }) {
	const { t } = useTranslation();
	return (
		<Badge color={COLORS[status]} variant="light">
			{t(`status.${status}`)}
		</Badge>
	);
}
