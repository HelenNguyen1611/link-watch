"use client";

import type { IncidentDetail as Detail } from "@linkwatch/core";
import {
	Alert,
	Anchor,
	Button,
	Group,
	Loader,
	SimpleGrid,
	Stack,
	Table,
	Text,
	Textarea,
	Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconChevronLeft } from "@/components/icons";
import { ApiError } from "@/lib/api";
import { useApi } from "@/lib/api-context";
import { COLOR, PALETTE } from "@/lib/colors";
import { formatDateTime, formatDuration } from "@/lib/format";
import { incidentDurationMs, linkHref } from "./duration";
import { IncidentStateBadge, IncidentTypeBadge } from "./IncidentBadges";

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

/** FR-19: one incident — timeline, emails sent, Acknowledge + note. */
export function IncidentDetail({ id }: { id: string }) {
	const { t } = useTranslation();
	const api = useApi();
	const query = useQuery({
		queryKey: ["incident", id],
		queryFn: () => api.getIncident(id),
		refetchInterval: (q) => (q.state.data?.state === "closed" ? false : 60_000),
	});

	const back = (
		<Anchor component={Link} href="/incidents/" size="sm" c="dimmed">
			<Group gap={4}>
				<IconChevronLeft size={16} />
				{t("incidents.back")}
			</Group>
		</Anchor>
	);

	if (query.isPending)
		return (
			<Stack>
				{back}
				<Loader />
			</Stack>
		);
	if (query.isError) {
		const notFound =
			query.error instanceof ApiError && query.error.status === 404;
		if (query.error instanceof ApiError && query.error.status === 401)
			return null;
		return (
			<Stack>
				{back}
				<Alert color={PALETTE.danger} variant="light">
					{t(notFound ? "incidents.notFound" : "incidents.loadError")}
				</Alert>
			</Stack>
		);
	}
	const i = query.data;
	return (
		<Stack gap={32} maw={960}>
			{back}
			<Stack gap="xs">
				<Group gap="xs">
					<IncidentTypeBadge type={i.type} />
					<IncidentStateBadge state={i.state} acked={Boolean(i.ackedAt)} />
				</Group>
				<Title order={2} fz="lg" style={{ wordBreak: "break-all" }}>
					{i.url}
				</Title>
				<Group gap="md">
					<Text size="sm" c="dimmed">
						{i.domain}
					</Text>
					<Anchor component={Link} href={linkHref(i.linkId)} size="sm">
						{t("incidents.viewLink")}
					</Anchor>
					<Anchor
						href={i.url}
						target="_blank"
						rel="noopener noreferrer"
						size="sm"
					>
						{t("incidents.openUrl")}
					</Anchor>
				</Group>
			</Stack>

			<SimpleGrid cols={{ base: 2, sm: 4 }} spacing="lg">
				<Field label={t("incidents.col.opened")}>
					{formatDateTime(i.openedAt)}
				</Field>
				<Field label={t("incidents.closedAt")}>
					{formatDateTime(i.closedAt)}
				</Field>
				<Field label={t("incidents.col.duration")}>
					{formatDuration(incidentDurationMs(i, new Date()))}
				</Field>
				<Field label={t("incidents.col.error")}>
					{[i.httpCode, i.errorType && t(`errorType.${i.errorType}`)]
						.filter(Boolean)
						.join(" · ") || "—"}
				</Field>
			</SimpleGrid>

			<Acknowledge incident={i} />
			<Notifications incident={i} />
		</Stack>
	);
}

function Acknowledge({ incident: i }: { incident: Detail }) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [note, setNote] = useState(i.note ?? "");
	const ack = useMutation({
		mutationFn: () => api.ackIncident(i.id, note.trim()),
		onSuccess: (saved) => {
			queryClient.setQueryData<Detail>(["incident", i.id], (old) =>
				old ? { ...old, ...saved } : old,
			);
			void queryClient.invalidateQueries({ queryKey: ["incidents"] });
			notifications.show({
				color: PALETTE.success,
				message: t("incidents.ack.saved"),
			});
		},
	});
	const failed =
		ack.error instanceof ApiError && ack.error.status === 409
			? t("incidents.ack.closed")
			: ack.error &&
					!(ack.error instanceof ApiError && ack.error.status === 401)
				? t("incidents.ack.failed")
				: undefined;

	return (
		<Stack gap="sm">
			<Title order={3} fz="md">
				{t("incidents.ack.title")}
			</Title>
			{i.ackedAt ? (
				<Text size="sm">
					{t("incidents.ack.by", {
						by: i.ackedBy,
						at: formatDateTime(i.ackedAt),
					})}
				</Text>
			) : (
				<Text size="sm" c="dimmed">
					{t(
						i.state === "closed"
							? "incidents.ack.notNeeded"
							: "incidents.ack.hint",
					)}
				</Text>
			)}
			{i.state !== "closed" && (
				<>
					<Textarea
						label={t("incidents.ack.note")}
						placeholder={t("incidents.ack.notePlaceholder")}
						rows={3}
						maxLength={1000}
						value={note}
						onChange={(e) => setNote(e.currentTarget.value)}
					/>
					<Group>
						<Button
							variant="light"
							loading={ack.isPending}
							onClick={() => ack.mutate()}
						>
							{t(i.ackedAt ? "incidents.ack.update" : "incidents.ack.button")}
						</Button>
					</Group>
				</>
			)}
			{i.state === "closed" && i.note && (
				<Text size="sm">
					{t("incidents.ack.note")}: {i.note}
				</Text>
			)}
			{failed && (
				<Text size="sm" c={COLOR.danger} role="alert">
					{failed}
				</Text>
			)}
		</Stack>
	);
}

function Notifications({ incident: i }: { incident: Detail }) {
	const { t } = useTranslation();
	return (
		<Stack gap="sm">
			<Title order={3} fz="md">
				{t("incidents.emails.title")}
			</Title>
			{i.notifications.length === 0 ? (
				<Text size="sm" c="dimmed">
					{t("incidents.emails.none")}
				</Text>
			) : (
				<Table.ScrollContainer minWidth={560}>
					<Table verticalSpacing="xs" borderColor="gray.2">
						<Table.Thead>
							<Table.Tr>
								{["sentAt", "kind", "to", "status"].map((k) => (
									<Table.Th key={k} c="dimmed" fz="xs" fw={400}>
										{t(`incidents.emails.${k}`)}
									</Table.Th>
								))}
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{i.notifications.map((n) => (
								<Table.Tr key={`${n.sentAt}-${n.to}-${n.kind}`}>
									<Table.Td style={{ whiteSpace: "nowrap" }}>
										{formatDateTime(n.sentAt)}
									</Table.Td>
									<Table.Td>
										{t(`incidents.emails.kinds.${n.kind}`, {
											defaultValue: n.kind,
										})}
									</Table.Td>
									<Table.Td>{n.to}</Table.Td>
									<Table.Td>
										<Text
											size="sm"
											c={n.status === "sent" ? COLOR.success : COLOR.danger}
											title={n.error}
										>
											{t(`incidents.emails.statuses.${n.status}`, {
												defaultValue: n.status,
											})}
											{n.error ? ` — ${n.error}` : ""}
										</Text>
									</Table.Td>
								</Table.Tr>
							))}
						</Table.Tbody>
					</Table>
				</Table.ScrollContainer>
			)}
		</Stack>
	);
}
