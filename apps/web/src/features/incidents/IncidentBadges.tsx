import type { IncidentState, IncidentType } from "@linkwatch/core";
import { Badge } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { PALETTE } from "@/lib/colors";

/** SRS 5.1: Dead link / Site down. */
export function IncidentTypeBadge({ type }: { type: IncidentType }) {
	const { t } = useTranslation();
	return (
		<Badge color={PALETTE.danger} variant="light" radius="sm">
			{t(`status.${type}`)}
		</Badge>
	);
}

/** SRS 6.2: Open / Verifying / Closed (+ Acknowledged). */
export function IncidentStateBadge({
	state,
	acked,
}: {
	state: IncidentState;
	acked?: boolean;
}) {
	const { t } = useTranslation();
	const color =
		state === "closed"
			? PALETTE.success
			: state === "verifying"
				? "yellow"
				: PALETTE.danger;
	return (
		<Badge
			color={color}
			variant={state === "closed" ? "light" : "outline"}
			radius="sm"
		>
			{state !== "closed" && acked
				? t("incidents.state.acked")
				: t(`incidents.state.${state}`)}
		</Badge>
	);
}
