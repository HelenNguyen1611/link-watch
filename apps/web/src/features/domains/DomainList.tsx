"use client";

import type { DomainSummary, ScheduleView } from "@linkwatch/core";
import {
	Alert,
	Anchor,
	Group,
	Loader,
	Stack,
	Table,
	Text,
	TextInput,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconSearch } from "@/components/icons";
import { describeRule } from "@/features/schedules/describe";
import { ApiError } from "@/lib/api";
import { useApi } from "@/lib/api-context";
import { PALETTE } from "@/lib/colors";
import { formatDateTime, formatMs } from "@/lib/format";
import { DomainStatusBadge } from "./DomainStatusBadge";

export const domainHref = (name: string) =>
	`/domains/?d=${encodeURIComponent(name)}`;

const pct = (v: number | undefined) => (v === undefined ? "—" : `${v}%`);

/** FR-13: "Every 15 minutes (from the domain)". */
export function scheduleLabel(
	schedule: DomainSummary["schedule"],
	schedules: readonly ScheduleView[] | undefined,
	t: (k: string, o?: Record<string, unknown>) => string,
) {
	const s = schedules?.find((x) => x.id === (schedule.scheduleId ?? "default"));
	const rule = s ? describeRule(s.rule, t) : "—";
	return `${rule} (${t(`schedules.source.${schedule.source}`)})`;
}

/** SCR-02: every domain with its overview (FR-09, FR-10, FR-13). */
export function DomainList() {
	const { t } = useTranslation();
	const api = useApi();
	const domains = useQuery({
		queryKey: ["domains"],
		queryFn: () => api.listDomains(),
		refetchInterval: 5 * 60_000,
	});
	const schedules = useQuery({
		queryKey: ["schedules"],
		queryFn: () => api.listSchedules(),
	});
	const [q, setQ] = useState("");
	const shown = useMemo(() => {
		const needle = q.trim().toLowerCase();
		return (domains.data?.items ?? []).filter(
			(d) =>
				!needle ||
				d.name.includes(needle) ||
				(d.displayName ?? "").toLowerCase().includes(needle),
		);
	}, [domains.data, q]);

	if (domains.isPending) return <Loader />;
	if (domains.isError)
		return domains.error instanceof ApiError &&
			domains.error.status === 401 ? null : (
			<Alert color={PALETTE.danger} variant="light">
				{t("domains.loadError")}
			</Alert>
		);
	if (domains.data.items.length === 0)
		return <Text c="dimmed">{t("domains.empty")}</Text>;

	return (
		<Stack gap="md">
			<TextInput
				label={t("domains.search")}
				placeholder={t("domains.searchPlaceholder")}
				leftSection={<IconSearch size={16} />}
				value={q}
				onChange={(e) => setQ(e.currentTarget.value)}
				maw={360}
			/>
			<Table.ScrollContainer minWidth={980}>
				<Table
					verticalSpacing="sm"
					borderColor="gray.2"
					highlightOnHover
					aria-label={t("nav.domains")}
				>
					<Table.Thead>
						<Table.Tr>
							{[
								"domain",
								"status",
								"links",
								"uptime",
								"response",
								"lastChecked",
								"nextCheck",
								"schedule",
							].map((k) => (
								<Table.Th
									key={k}
									c="dimmed"
									fz="xs"
									fw={400}
									style={{ whiteSpace: "nowrap" }}
								>
									{t(`domains.col.${k}`)}
								</Table.Th>
							))}
						</Table.Tr>
					</Table.Thead>
					<Table.Tbody>
						{shown.map((d) => (
							<Table.Tr key={d.name}>
								<Table.Td>
									<Anchor
										component={Link}
										href={domainHref(d.name)}
										size="sm"
										fw={500}
									>
										{d.displayName ?? d.name}
									</Anchor>
									{d.displayName && (
										<Text size="xs" c="dimmed">
											{d.name}
										</Text>
									)}
									{!d.enabled && (
										<Text size="xs" c="dimmed">
											{t("domains.disabled")}
										</Text>
									)}
								</Table.Td>
								<Table.Td>
									<DomainStatusBadge status={d.status} />
								</Table.Td>
								<Table.Td style={{ whiteSpace: "nowrap" }}>
									<Text size="sm">
										{t("domains.linkCounts", {
											total: d.total,
											paused: d.paused,
										})}
									</Text>
									<Group gap={6}>
										{(
											[
												"down",
												"dead",
												"suspect",
												"slow",
												"up",
												"pending",
											] as const
										)
											.filter((s) => d.counts[s] > 0)
											.map((s) => (
												<Text key={s} size="xs" c="dimmed">
													{t(`status.${s}`)}: {d.counts[s]}
												</Text>
											))}
									</Group>
								</Table.Td>
								<Table.Td style={{ whiteSpace: "nowrap" }}>
									{t("domains.uptimeValue", {
										d7: pct(d.uptime7),
										d30: pct(d.uptime30),
									})}
								</Table.Td>
								<Table.Td style={{ whiteSpace: "nowrap" }}>
									{formatMs(d.avgResponseMs)}
								</Table.Td>
								<Table.Td style={{ whiteSpace: "nowrap" }}>
									{formatDateTime(d.lastCheckedAt)}
								</Table.Td>
								<Table.Td style={{ whiteSpace: "nowrap" }}>
									{formatDateTime(d.nextRunAt)}
								</Table.Td>
								<Table.Td>
									<Text size="sm">
										{scheduleLabel(d.schedule, schedules.data?.items, t)}
									</Text>
								</Table.Td>
							</Table.Tr>
						))}
					</Table.Tbody>
				</Table>
			</Table.ScrollContainer>
		</Stack>
	);
}
