"use client";

import type { LinkView } from "@linkwatch/core";
import {
	Alert,
	Anchor,
	Badge,
	Button,
	Group,
	Loader,
	SimpleGrid,
	Stack,
	Table,
	Text,
	Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type ReactNode, Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconChevronLeft, IconRefresh } from "@/components/icons";
import { PageHeader } from "@/components/PageHeader";
import { useResolveClaims } from "@/features/incidents/ClaimSection";
import { incidentHref } from "@/features/incidents/duration";
import {
	IncidentStateBadge,
	IncidentTypeBadge,
} from "@/features/incidents/IncidentBadges";
import { ApiError } from "@/lib/api";
import { useApi } from "@/lib/api-context";
import { COLOR, PALETTE } from "@/lib/colors";
import { formatDateTime, formatDuration, formatMs } from "@/lib/format";
import { StatusBadge } from "../StatusBadge";
import { httpCodeColor } from "../status-style";
import { ResponseChart } from "./ResponseChart";
import { UptimeBar } from "./UptimeBar";

/** FR-16: poll the link while a Check now result is awaited. */
export const CHECK_NOW_POLL_MS = 3_000;
/** FR-16: a result is expected within 60 seconds. */
export const CHECK_NOW_TIMEOUT_MS = 60_000;

const detailKey = (id: string) => ["link", id] as const;

function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<Stack gap={2}>
			<Text size="xs" c="dimmed">
				{label}
			</Text>
			<Text size="sm" component="div">
				{children}
			</Text>
		</Stack>
	);
}

/** FR-16: queue a check, then poll this link until its last check time moves. */
function useCheckNow(link: LinkView | undefined, refetch: () => void) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [since, setSince] = useState<string | null>(null);

	const start = useMutation({
		mutationFn: () => api.checkNow({ linkIds: [link?.id ?? ""] }),
		onSuccess: (res) => {
			if (res.queued.length === 0) {
				notifications.show({
					color: "yellow",
					message: t(
						res.skipped[0]?.reason === "paused"
							? "linkDetail.checkNow.paused"
							: "linkDetail.checkNow.notQueued",
					),
				});
				return;
			}
			setSince(new Date().toISOString());
		},
		onError: (err) => {
			if (err instanceof ApiError && err.status === 401) return;
			notifications.show({
				color: PALETTE.danger,
				message: t("linkDetail.checkNow.failed"),
			});
		},
	});

	useEffect(() => {
		if (!since || !link) return;
		if (link.lastCheckedAt && link.lastCheckedAt > since) {
			setSince(null);
			notifications.show({
				color: PALETTE.success,
				message: t("linkDetail.checkNow.done", {
					status: t(`status.${link.status}`),
				}),
			});
			void queryClient.invalidateQueries({
				queryKey: ["link-history", link.id],
			});
			void queryClient.invalidateQueries({ queryKey: ["links"] });
			return;
		}
		const timer = setTimeout(() => {
			if (Date.now() - Date.parse(since) >= CHECK_NOW_TIMEOUT_MS) {
				setSince(null);
				notifications.show({
					color: "yellow",
					message: t("linkDetail.checkNow.slow"),
				});
			} else refetch();
		}, CHECK_NOW_POLL_MS);
		return () => clearTimeout(timer);
	}, [since, link, refetch, queryClient, t]);

	return {
		checking: start.isPending || since !== null,
		run: () => start.mutate(),
	};
}

function LinkDetail({ id }: { id: string }) {
	const { t } = useTranslation();
	const api = useApi();
	const link = useQuery({
		queryKey: detailKey(id),
		queryFn: () => api.getLink(id),
	});
	const checks = useQuery({
		queryKey: ["link-history", id, "checks"],
		queryFn: () => api.linkChecks(id, 100),
		enabled: link.isSuccess,
	});
	const uptime = useQuery({
		queryKey: ["link-history", id, "uptime"],
		queryFn: () => api.linkUptime(id, 30),
		enabled: link.isSuccess,
	});
	const incidents = useQuery({
		queryKey: ["link-history", id, "incidents"],
		queryFn: () => api.linkIncidents(id),
		enabled: link.isSuccess,
	});
	const checkNow = useCheckNow(link.data, () => void link.refetch());
	// FR-41: the open incident of this link can be reported fixed from here.
	const resolve = useResolveClaims();
	const openIncident = incidents.data?.items.find((i) => i.state === "open");

	const back = (
		<Anchor component={Link} href="/links/" size="sm" c="dimmed">
			<Group gap={4}>
				<IconChevronLeft size={16} />
				{t("linkDetail.back")}
			</Group>
		</Anchor>
	);
	if (link.isPending)
		return (
			<Stack>
				{back}
				<Loader />
			</Stack>
		);
	if (link.isError) {
		if (link.error instanceof ApiError && link.error.status === 401)
			return null;
		const notFound =
			link.error instanceof ApiError && link.error.status === 404;
		return (
			<Stack>
				{back}
				<Alert color={PALETTE.danger} variant="light">
					{t(notFound ? "linkDetail.notFound" : "linkDetail.loadError")}
				</Alert>
			</Stack>
		);
	}
	const l = link.data;

	return (
		<Stack gap={32} maw={1100}>
			{back}
			<Group justify="space-between" align="flex-start" gap="md">
				<Stack gap={6} style={{ flex: "1 1 320px", minWidth: 0 }}>
					<Group gap="xs">
						<StatusBadge status={l.status} />
						{l.paused && (
							<Badge variant="light" color="gray">
								{t("linkDetail.paused")}
							</Badge>
						)}
					</Group>
					<Title order={2} fz="lg" style={{ wordBreak: "break-all" }}>
						{l.url}
					</Title>
					<Text size="sm" c="dimmed">
						{[l.name, l.domain].filter(Boolean).join(" · ")}
					</Text>
				</Stack>
				<Group gap="xs">
					<Button
						variant="light"
						leftSection={<IconRefresh size={16} />}
						loading={checkNow.checking}
						disabled={l.paused}
						onClick={checkNow.run}
					>
						{t("linkDetail.checkNow.button")}
					</Button>
					{openIncident && (
						<Button
							variant="light"
							color={PALETTE.success}
							loading={resolve.isPending}
							onClick={() => resolve.mutate({ ids: [openIncident.id] })}
						>
							{t("claims.button")}
						</Button>
					)}
					<Button
						variant="subtle"
						component="a"
						href={l.url}
						target="_blank"
						rel="noopener noreferrer"
					>
						{t("linkDetail.openUrl")}
					</Button>
				</Group>
			</Group>

			<SimpleGrid cols={{ base: 2, sm: 4 }} spacing="lg">
				<Field label={t("links.col.lastChecked")}>
					{formatDateTime(l.lastCheckedAt)}
				</Field>
				<Field label={t("linkDetail.nextCheck")}>
					{formatDateTime(l.nextRunAt)}
				</Field>
				<Field label={t("links.col.http")}>
					<Text size="sm" c={httpCodeColor(l.lastHttpCode)}>
						{l.lastHttpCode ?? "—"}
					</Text>
				</Field>
				<Field label={t("links.col.responseTime")}>
					{formatMs(l.lastResponseMs)}
				</Field>
			</SimpleGrid>

			{uptime.data && <UptimeBar uptime={uptime.data} />}

			<Stack gap="sm">
				<Title order={3} fz="md">
					{t("linkDetail.chart.title")}
				</Title>
				{checks.data && <ResponseChart checks={checks.data.items} />}
			</Stack>

			<Stack gap="sm">
				<Title order={3} fz="md">
					{t("linkDetail.incidents.title")}
				</Title>
				{incidents.data?.items.length === 0 ? (
					<Text size="sm" c="dimmed">
						{t("linkDetail.incidents.none")}
					</Text>
				) : (
					<Table verticalSpacing="xs" borderColor="gray.2">
						<Table.Tbody>
							{incidents.data?.items.map((i) => (
								<Table.Tr key={i.id}>
									<Table.Td style={{ whiteSpace: "nowrap" }}>
										<Anchor
											component={Link}
											href={incidentHref(i.id)}
											size="sm"
										>
											{formatDateTime(i.openedAt)}
										</Anchor>
									</Table.Td>
									<Table.Td>
										<IncidentTypeBadge type={i.type} />
									</Table.Td>
									<Table.Td>
										<IncidentStateBadge
											state={i.state}
											acked={Boolean(i.ackedAt)}
										/>
									</Table.Td>
									<Table.Td style={{ whiteSpace: "nowrap" }}>
										{i.state === "closed" ? formatDuration(i.downtimeMs) : "—"}
									</Table.Td>
								</Table.Tr>
							))}
						</Table.Tbody>
					</Table>
				)}
			</Stack>

			<Stack gap="sm">
				<Title order={3} fz="md">
					{t("linkDetail.checks.title", {
						count: checks.data?.items.length ?? 0,
					})}
				</Title>
				{checks.data?.items.length === 0 ? (
					<Text size="sm" c="dimmed">
						{t("linkDetail.checks.none")}
					</Text>
				) : (
					<Table.ScrollContainer minWidth={640}>
						<Table
							verticalSpacing="xs"
							borderColor="gray.2"
							aria-label={t("linkDetail.checks.title", {
								count: checks.data?.items.length ?? 0,
							})}
						>
							<Table.Thead>
								<Table.Tr>
									{["time", "result", "http", "response", "error"].map((k) => (
										<Table.Th key={k} c="dimmed" fz="xs" fw={400}>
											{t(`linkDetail.checks.col.${k}`)}
										</Table.Th>
									))}
								</Table.Tr>
							</Table.Thead>
							<Table.Tbody>
								{checks.data?.items.map((c) => (
									<Table.Tr key={c.checkedAt}>
										<Table.Td style={{ whiteSpace: "nowrap" }}>
											{formatDateTime(c.checkedAt)}
										</Table.Td>
										<Table.Td>
											<StatusBadge status={c.result} />
										</Table.Td>
										<Table.Td>
											<Text size="sm" c={httpCodeColor(c.httpCode)}>
												{c.httpCode ?? "—"}
											</Text>
										</Table.Td>
										<Table.Td style={{ whiteSpace: "nowrap" }}>
											{formatMs(c.responseMs)}
										</Table.Td>
										<Table.Td>
											<Text
												size="sm"
												c={c.errorType ? COLOR.danger : "dimmed"}
												title={c.errorMessage}
											>
												{c.errorType ? t(`errorType.${c.errorType}`) : "—"}
											</Text>
										</Table.Td>
									</Table.Tr>
								))}
							</Table.Tbody>
						</Table>
					</Table.ScrollContainer>
				)}
			</Stack>
		</Stack>
	);
}

function Content() {
	const { t } = useTranslation();
	const id = useSearchParams().get("id");
	if (!id)
		return (
			<Alert color={PALETTE.danger} variant="light">
				{t("linkDetail.notFound")}
			</Alert>
		);
	return <LinkDetail id={id} />;
}

/** SCR-05: link detail (FR-16, FR-17, FR-18). */
export function LinkDetailPage() {
	const { t } = useTranslation();
	return (
		<>
			<PageHeader title={t("linkDetail.title")} mb={16} />
			<Suspense fallback={<Loader />}>
				<Content />
			</Suspense>
		</>
	);
}
