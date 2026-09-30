"use client";

import type { IncidentView } from "@linkwatch/core";
import {
	Alert,
	Anchor,
	Button,
	Group,
	Loader,
	SegmentedControl,
	Stack,
	Table,
	Text,
} from "@mantine/core";
import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/lib/api";
import { useApi } from "@/lib/api-context";
import { PALETTE } from "@/lib/colors";
import { formatDateTime, formatDuration } from "@/lib/format";
import { incidentDurationMs, incidentHref } from "./duration";
import { IncidentStateBadge, IncidentTypeBadge } from "./IncidentBadges";

/** Open incidents change with every recheck (10 min): refresh every minute. */
export const INCIDENTS_REFRESH_MS = 60_000;

type Tab = "active" | "closed";

/** FR-19: incidents newest first — active (open / verifying) or closed (paged). */
export function IncidentList() {
	const { t } = useTranslation();
	const api = useApi();
	const [tab, setTab] = useState<Tab>("active");
	const query = useInfiniteQuery({
		queryKey: ["incidents", tab],
		queryFn: ({ pageParam }) =>
			api.listIncidents({ state: tab, cursor: pageParam }),
		initialPageParam: null as string | null,
		getNextPageParam: (last) => last.cursor,
		refetchInterval: tab === "active" ? INCIDENTS_REFRESH_MS : false,
	});
	const items = query.data?.pages.flatMap((p) => p.items) ?? [];
	const unauthorized =
		query.error instanceof ApiError && query.error.status === 401;
	const now = new Date();

	return (
		<Stack gap="md">
			<SegmentedControl
				value={tab}
				onChange={(v) => setTab(v as Tab)}
				data={[
					{ value: "active", label: t("incidents.tabs.active") },
					{ value: "closed", label: t("incidents.tabs.closed") },
				]}
				w="fit-content"
			/>
			{query.isPending ? (
				<Loader />
			) : query.isError ? (
				unauthorized ? null : (
					<Alert color={PALETTE.danger} variant="light">
						{t("incidents.loadError")}
					</Alert>
				)
			) : items.length === 0 ? (
				<Text c="dimmed">{t(`incidents.empty.${tab}`)}</Text>
			) : (
				<Table.ScrollContainer minWidth={760}>
					<Table highlightOnHover verticalSpacing="sm" borderColor="gray.2">
						<Table.Thead>
							<Table.Tr>
								{["url", "type", "state", "opened", "duration", "error"].map(
									(k) => (
										<Table.Th key={k} c="dimmed" fz="xs" fw={400}>
											{t(`incidents.col.${k}`)}
										</Table.Th>
									),
								)}
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{items.map((i) => (
								<IncidentRow key={i.id} incident={i} now={now} />
							))}
						</Table.Tbody>
					</Table>
				</Table.ScrollContainer>
			)}
			{query.hasNextPage && (
				<Group>
					<Button
						variant="subtle"
						loading={query.isFetchingNextPage}
						onClick={() => query.fetchNextPage()}
					>
						{t("incidents.loadMore")}
					</Button>
				</Group>
			)}
		</Stack>
	);
}

function IncidentRow({
	incident: i,
	now,
}: {
	incident: IncidentView;
	now: Date;
}) {
	const { t } = useTranslation();
	return (
		<Table.Tr>
			<Table.Td maw={320}>
				<Anchor
					component={Link}
					href={incidentHref(i.id)}
					size="sm"
					lineClamp={2}
					style={{ wordBreak: "break-all" }}
				>
					{i.url}
				</Anchor>
				<Text size="xs" c="dimmed">
					{i.domain}
				</Text>
			</Table.Td>
			<Table.Td>
				<IncidentTypeBadge type={i.type} />
			</Table.Td>
			<Table.Td>
				<IncidentStateBadge state={i.state} acked={Boolean(i.ackedAt)} />
			</Table.Td>
			<Table.Td style={{ whiteSpace: "nowrap" }}>
				{formatDateTime(i.openedAt)}
			</Table.Td>
			<Table.Td style={{ whiteSpace: "nowrap" }}>
				{formatDuration(incidentDurationMs(i, now))}
			</Table.Td>
			<Table.Td>
				<Text size="sm">
					{[i.httpCode, i.errorType && t(`errorType.${i.errorType}`)]
						.filter(Boolean)
						.join(" · ") || "—"}
				</Text>
			</Table.Td>
		</Table.Tr>
	);
}
