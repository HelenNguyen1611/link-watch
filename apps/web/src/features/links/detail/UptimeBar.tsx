"use client";

import type { UptimeSummary } from "@linkwatch/core";
import { Box, Group, Stack, Text, Tooltip } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { COLOR } from "@/lib/colors";

/** Day colour: 100% healthy, ≥ 95% warning, below that an outage day; grey = no check. */
export function uptimeColor(pct: number | undefined): string {
	if (pct === undefined) return "var(--mantine-color-gray-3)";
	if (pct >= 100) return COLOR.success;
	if (pct >= 95) return "var(--mantine-color-yellow-6)";
	return COLOR.danger;
}

const formatDay = (day: string) => {
	const [y, m, d] = day.split("-");
	return `${d}/${m}/${y}`;
};

/** FR-18: 30-day uptime bar, one cell per Vietnam day. */
export function UptimeBar({ uptime }: { uptime: UptimeSummary }) {
	const { t } = useTranslation();
	return (
		<Stack gap={6}>
			<Group justify="space-between">
				<Text size="sm" fw={500}>
					{t("linkDetail.uptime.title", { days: uptime.days.length })}
				</Text>
				<Text size="sm" fw={600} data-testid="uptime-total">
					{uptime.uptimePct === undefined
						? t("linkDetail.uptime.noData")
						: `${uptime.uptimePct}%`}
				</Text>
			</Group>
			<Group
				gap={3}
				wrap="nowrap"
				role="list"
				aria-label={t("linkDetail.uptime.title", { days: uptime.days.length })}
			>
				{uptime.days.map((d) => {
					const label =
						d.uptimePct === undefined
							? t("linkDetail.uptime.dayNoData", { day: formatDay(d.day) })
							: t("linkDetail.uptime.day", {
									day: formatDay(d.day),
									pct: d.uptimePct,
									checks: d.checks,
								});
					return (
						<Tooltip key={d.day} label={label} withArrow>
							<Box
								role="listitem"
								aria-label={label}
								h={28}
								style={{
									flex: 1,
									minWidth: 4,
									borderRadius: 2,
									background: uptimeColor(d.uptimePct),
								}}
							/>
						</Tooltip>
					);
				})}
			</Group>
			<Group justify="space-between">
				<Text size="xs" c="dimmed">
					{formatDay(uptime.days[0]?.day ?? "")}
				</Text>
				<Text size="xs" c="dimmed">
					{t("linkDetail.uptime.today")}
				</Text>
			</Group>
		</Stack>
	);
}
