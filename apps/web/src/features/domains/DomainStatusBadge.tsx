import type { DomainStatus } from "@linkwatch/core";
import { Badge } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { PALETTE } from "@/lib/colors";

const COLOR: Record<DomainStatus, string> = {
	normal: PALETTE.success,
	warning: "yellow",
	error: "orange",
	down: PALETTE.danger,
};

/** FR-09: Normal / Warning / Error / Down. */
export function DomainStatusBadge({ status }: { status: DomainStatus }) {
	const { t } = useTranslation();
	return (
		<Badge color={COLOR[status]} variant="light" radius="sm">
			{t(`domains.status.${status}`)}
		</Badge>
	);
}
