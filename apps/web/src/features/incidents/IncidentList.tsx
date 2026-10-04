"use client";

import type { IncidentView } from "@linkwatch/core";
import {
	Alert,
	Anchor,
	Button,
	Checkbox,
	Group,
	Loader,
	SegmentedControl,
	Stack,
	Table,
	Text,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type Api, ApiError } from "@/lib/api";
import { useApi } from "@/lib/api-context";
import { useCan } from "@/lib/auth-context";
import { PALETTE } from "@/lib/colors";
import { formatDateTime, formatDuration } from "@/lib/format";
import { useResolveClaims } from "./ClaimSection";
import { incidentDurationMs, incidentHref } from "./duration";
import { IncidentStateBadge, IncidentTypeBadge } from "./IncidentBadges";

/** Open incidents change with every recheck (10 min): refresh every minute. */
export const INCIDENTS_REFRESH_MS = 60_000;

const TABS = ["active", "closed", "all"] as const;
type Tab = (typeof TABS)[number];

/** The last tab the viewer picked, so returning from an incident keeps it. */
export const INCIDENTS_TAB_STORAGE_KEY = "linkwatch.incidentsTab";

/**
 * "All": the first page is every active incident plus the first page of closed ones,
 * newest first; later pages are older closed incidents.
 */
async function listAll(api: Api, cursor: string | null) {
	if (cursor) return api.listIncidents({ state: "closed", cursor });
	const [active, closed] = await Promise.all([
		api.listIncidents({ state: "active" }),
		api.listIncidents({ state: "closed" }),
	]);
	return {
		items: [...active.items, ...closed.items].sort((a, b) =>
			b.openedAt.localeCompare(a.openedAt),
		),
		cursor: closed.cursor,
	};
}

/** FR-19: incidents newest first — active (open / verifying), closed (paged) or all. */
export function IncidentList() {
	const { t } = useTranslation();
	const api = useApi();
	const [stored, setTab] = useLocalStorage<Tab>({
		key: INCIDENTS_TAB_STORAGE_KEY,
		defaultValue: "active",
		getInitialValueInEffect: true,
	});
	const tab: Tab = TABS.includes(stored) ? stored : "active";
	// FR-41: several open incidents can be reported fixed at once.
	const [selected, setSelected] = useState<string[]>([]);
	// HLR-09: only roles that handle incidents select rows for "Fixed — check again".
	const canHandle = useCan()("handle_incidents");
	const selecting = tab !== "closed" && canHandle;
	const resolve = useResolveClaims(() => setSelected([]));
	const query = useInfiniteQuery({
		queryKey: ["incidents", tab],
		queryFn: ({ pageParam }) =>
			tab === "all"
				? listAll(api, pageParam)
				: api.listIncidents({ state: tab, cursor: pageParam }),
		initialPageParam: null as string | null,
		getNextPageParam: (last) => last.cursor,
		refetchInterval: tab === "closed" ? false : INCIDENTS_REFRESH_MS,
	});
	const items = query.data?.pages.flatMap((p) => p.items) ?? [];
	const unauthorized =
		query.error instanceof ApiError && query.error.status === 401;
	const now = new Date();

	return (
		<Stack gap="md">
			<SegmentedControl
				value={tab}
				onChange={(v) => {
					setTab(v as Tab);
					setSelected([]);
				}}
				data={TABS.map((v) => ({
					value: v,
					label: t(`incidents.tabs.${v}`),
				}))}
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
				<>
					{selecting && selected.length > 0 && (
						<Group gap="xs" role="toolbar" aria-label={t("claims.bulkLabel")}>
							<Text size="sm" fw={500}>
								{t("links.bulk.selected", { count: selected.length })}
							</Text>
							<Button
								size="xs"
								variant="light"
								loading={resolve.isPending}
								onClick={() => resolve.mutate({ ids: selected })}
							>
								{t("claims.button")}
							</Button>
							<Button
								size="xs"
								variant="subtle"
								color="gray"
								onClick={() => setSelected([])}
							>
								{t("links.bulk.clear")}
							</Button>
						</Group>
					)}
					<Table.ScrollContainer minWidth={760}>
						<Table highlightOnHover verticalSpacing="sm" borderColor="gray.2">
							<Table.Thead>
								<Table.Tr>
									{selecting && <Table.Th w={1} />}
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
									<IncidentRow
										key={i.id}
										incident={i}
										now={now}
										selectable={selecting && i.state === "open"}
										selected={selected.includes(i.id)}
										onToggle={() =>
											setSelected((s) =>
												s.includes(i.id)
													? s.filter((x) => x !== i.id)
													: [...s, i.id],
											)
										}
										showSelect={selecting}
									/>
								))}
							</Table.Tbody>
						</Table>
					</Table.ScrollContainer>
				</>
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
	showSelect,
	selectable,
	selected,
	onToggle,
}: {
	incident: IncidentView;
	now: Date;
	showSelect: boolean;
	selectable: boolean;
	selected: boolean;
	onToggle: () => void;
}) {
	const { t } = useTranslation();
	return (
		<Table.Tr>
			{showSelect && (
				<Table.Td>
					{selectable && (
						<Checkbox
							size="xs"
							checked={selected}
							onChange={onToggle}
							aria-label={t("claims.select", { url: i.url })}
						/>
					)}
				</Table.Td>
			)}
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
