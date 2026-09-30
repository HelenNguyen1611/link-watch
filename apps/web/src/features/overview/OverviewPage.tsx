"use client";

import type { DomainSummary, IncidentView } from "@linkwatch/core";
import {
	Alert,
	Anchor,
	Button,
	Card,
	Group,
	Loader,
	SimpleGrid,
	Stack,
	Table,
	Text,
	Title,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/PageHeader";
import { domainHref } from "@/features/domains/DomainList";
import { DomainStatusBadge } from "@/features/domains/DomainStatusBadge";
import {
	incidentDurationMs,
	incidentHref,
} from "@/features/incidents/duration";
import { IncidentTypeBadge } from "@/features/incidents/IncidentBadges";
import { ApiError } from "@/lib/api";
import { useApi } from "@/lib/api-context";
import { COLOR, PALETTE } from "@/lib/colors";
import { formatDateTime, formatDuration } from "@/lib/format";
import { needsAttention, overviewTotals } from "./totals";

/** Rows shown in each list; the full lists are one click away. */
const LIST_LIMIT = 10;

function Stat({
	label,
	value,
	detail,
	color,
}: {
	label: string;
	value: string;
	detail?: string;
	color?: string;
}) {
	return (
		<Card withBorder radius="md" padding="md" aria-label={label}>
			<Text size="xs" c="dimmed">
				{label}
			</Text>
			<Text fz={28} fw={600} c={color} data-testid={`stat-${label}`}>
				{value}
			</Text>
			{detail && (
				<Text size="xs" c="dimmed">
					{detail}
				</Text>
			)}
		</Card>
	);
}

function AttentionTable({ domains }: { domains: DomainSummary[] }) {
	const { t } = useTranslation();
	if (domains.length === 0)
		return (
			<Text size="sm" c={COLOR.success}>
				{t("overview.allNormal")}
			</Text>
		);
	return (
		<Table.ScrollContainer minWidth={560}>
			<Table verticalSpacing="xs" aria-label={t("overview.attention")}>
				<Table.Tbody>
					{domains.slice(0, LIST_LIMIT).map((d) => (
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
							</Table.Td>
							<Table.Td>
								<DomainStatusBadge status={d.status} />
							</Table.Td>
							<Table.Td>
								<Text size="sm">
									{(["down", "dead", "slow"] as const)
										.filter((s) => d.counts[s] > 0)
										.map((s) => `${t(`status.${s}`)}: ${d.counts[s]}`)
										.join(" · ")}
								</Text>
							</Table.Td>
							<Table.Td>
								<Text size="xs" c="dimmed">
									{formatDateTime(d.lastCheckedAt)}
								</Text>
							</Table.Td>
						</Table.Tr>
					))}
				</Table.Tbody>
			</Table>
		</Table.ScrollContainer>
	);
}

function OpenIncidents({ items }: { items: IncidentView[] }) {
	const { t } = useTranslation();
	const now = new Date();
	if (items.length === 0)
		return (
			<Text size="sm" c={COLOR.success}>
				{t("incidents.empty.active")}
			</Text>
		);
	return (
		<Table.ScrollContainer minWidth={560}>
			<Table verticalSpacing="xs" aria-label={t("overview.openIncidents")}>
				<Table.Tbody>
					{items.slice(0, LIST_LIMIT).map((i) => (
						<Table.Tr key={i.id}>
							<Table.Td maw={320}>
								<Anchor
									component={Link}
									href={incidentHref(i.id)}
									size="sm"
									style={{ wordBreak: "break-all" }}
								>
									{i.url}
								</Anchor>
							</Table.Td>
							<Table.Td>
								<IncidentTypeBadge type={i.type} />
							</Table.Td>
							<Table.Td>
								<Text size="xs" c="dimmed">
									{formatDuration(incidentDurationMs(i, now))}
								</Text>
							</Table.Td>
						</Table.Tr>
					))}
				</Table.Tbody>
			</Table>
		</Table.ScrollContainer>
	);
}

/** SCR-01: health of every domain at a glance (FR-09, FR-10, NFR-02). */
export function OverviewPage() {
	const { t } = useTranslation();
	const api = useApi();
	// Same queries as the Domains and Incidents screens → shared cache.
	const domains = useQuery({
		queryKey: ["domains"],
		queryFn: () => api.listDomains(),
		refetchInterval: 5 * 60_000,
	});
	const incidents = useQuery({
		queryKey: ["incidents", "overview"],
		queryFn: () => api.listIncidents({ state: "active" }),
		refetchInterval: 60_000,
	});

	const header = (
		<PageHeader
			title={t("nav.overview")}
			description={t("overview.subtitle")}
			mb={24}
		/>
	);
	if (domains.isPending)
		return (
			<>
				{header}
				<Loader />
			</>
		);
	if (domains.isError)
		return (
			<>
				{header}
				{domains.error instanceof ApiError &&
				domains.error.status === 401 ? null : (
					<Alert color={PALETTE.danger} variant="light">
						{t("overview.loadError")}
					</Alert>
				)}
			</>
		);

	const items = domains.data.items;
	if (items.length === 0)
		return (
			<>
				{header}
				<Stack gap="sm" align="flex-start">
					<Text c="dimmed">{t("overview.empty")}</Text>
					<Button component={Link} href="/links/" variant="light">
						{t("overview.addLinks")}
					</Button>
				</Stack>
			</>
		);

	const totals = overviewTotals(items);
	const failing = totals.links.down + totals.links.dead;
	const open = incidents.data?.items ?? [];
	return (
		<>
			{header}
			<Stack gap="xl">
				<SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="md">
					<Stat
						label={t("overview.stat.domains")}
						value={String(items.length)}
						detail={t("overview.stat.domainsDetail", totals.domains)}
						color={totals.domains.down > 0 ? COLOR.danger : undefined}
					/>
					<Stat
						label={t("overview.stat.links")}
						value={String(totals.active)}
						detail={t("overview.stat.linksDetail", {
							up: totals.links.up,
							slow: totals.links.slow,
							paused: totals.paused,
						})}
					/>
					<Stat
						label={t("overview.stat.failing")}
						value={String(failing)}
						detail={t("overview.stat.failingDetail", {
							down: totals.links.down,
							dead: totals.links.dead,
							suspect: totals.links.suspect,
						})}
						color={failing > 0 ? COLOR.danger : COLOR.success}
					/>
					<Stat
						label={t("overview.stat.uptime")}
						value={totals.uptime7 === undefined ? "—" : `${totals.uptime7}%`}
						detail={t("overview.stat.uptimeDetail")}
					/>
				</SimpleGrid>

				<Stack gap="xs">
					<Group justify="space-between">
						<Title order={2} fz="md">
							{t("overview.attention")}
						</Title>
						<Anchor component={Link} href="/domains/" size="sm">
							{t("overview.allDomains")} →
						</Anchor>
					</Group>
					<AttentionTable domains={needsAttention(items)} />
				</Stack>

				<Stack gap="xs">
					<Group justify="space-between">
						<Title order={2} fz="md">
							{t("overview.openIncidents")}
							{incidents.data && ` (${open.length})`}
						</Title>
						<Anchor component={Link} href="/incidents/" size="sm">
							{t("overview.allIncidents")} →
						</Anchor>
					</Group>
					{incidents.isPending ? (
						<Loader size="sm" />
					) : (
						<OpenIncidents items={open} />
					)}
				</Stack>
			</Stack>
		</>
	);
}
