"use client";

import type { LinkView } from "@linkwatch/core";
import { Anchor, Button, Stack, Table, Text } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { IconTrash } from "@/components/icons";
import { useApi } from "@/lib/api-context";
import { PALETTE } from "@/lib/colors";
import { formatDateTime, formatMs } from "@/lib/format";
import { StatusBadge } from "./StatusBadge";
import { httpCodeColor, responseTimeColor } from "./status-style";
import css from "./table.module.css";

function DeleteButton({ id }: { id: string }) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [confirming, setConfirming] = useState(false);
	const remove = useMutation({
		mutationFn: () => api.deleteLink(id),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["links"] }),
	});
	return confirming ? (
		<Button
			size="xs"
			color={PALETTE.danger}
			leftSection={<IconTrash size={16} />}
			loading={remove.isPending}
			onClick={() => remove.mutate()}
			onBlur={() => setConfirming(false)}
		>
			{t("links.confirmDelete")}
		</Button>
	) : (
		<Button
			size="xs"
			variant="subtle"
			color={PALETTE.danger}
			leftSection={<IconTrash size={16} />}
			onClick={() => setConfirming(true)}
		>
			{t("links.delete")}
		</Button>
	);
}

/** FR-17: status, HTTP code, response time and last check of each link. */
export function LinkTable({ links }: { links: LinkView[] }) {
	const { t } = useTranslation();
	if (links.length === 0) return <Text c="dimmed">{t("links.empty")}</Text>;
	const th = (key: string) => (
		<Table.Th c="dimmed" fz="xs" fw={400} style={{ whiteSpace: "nowrap" }}>
			{t(`links.col.${key}`)}
		</Table.Th>
	);
	return (
		// Scrolls both ways inside the viewport so the header row and URL column stay pinned.
		<Table.ScrollContainer
			minWidth={820}
			maxHeight="calc(100dvh - var(--app-shell-header-height, 64px) - 2rem)"
			className={css.scroll}
			data-table-scroll
		>
			<Table
				stickyHeader
				highlightOnHover
				verticalSpacing="md"
				horizontalSpacing="sm"
				borderColor="gray.2"
			>
				<Table.Thead>
					<Table.Tr>
						<Table.Th
							c="dimmed"
							fz="xs"
							fw={400}
							className={css.sticky}
							data-sticky="true"
						>
							{t("links.col.url")}
						</Table.Th>
						{th("status")}
						{th("domain")}
						{th("http")}
						{th("responseTime")}
						{th("lastChecked")}
						<Table.Th />
					</Table.Tr>
				</Table.Thead>
				<Table.Tbody>
					{links.map((l) => (
						<Table.Tr key={l.id}>
							<Table.Td className={css.sticky} data-sticky="true">
								<Stack gap={0}>
									<Anchor
										href={l.url}
										target="_blank"
										rel="noopener noreferrer"
										size="sm"
										title={l.url}
										lineClamp={2}
										style={{ wordBreak: "break-all" }}
									>
										{l.url}
									</Anchor>
									{l.name && (
										<Text size="xs" c="dimmed" truncate>
											{l.name}
										</Text>
									)}
								</Stack>
							</Table.Td>
							<Table.Td>
								<Stack gap={2} align="flex-start">
									<StatusBadge status={l.status} />
									{l.lastErrorType && (
										<Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
											{t(`errorType.${l.lastErrorType}`)}
										</Text>
									)}
								</Stack>
							</Table.Td>
							<Table.Td>{l.domain}</Table.Td>
							<Table.Td>
								<Text
									size="sm"
									c={httpCodeColor(l.lastHttpCode)}
									fw={httpCodeColor(l.lastHttpCode) ? 500 : undefined}
								>
									{l.lastHttpCode ?? "—"}
								</Text>
							</Table.Td>
							<Table.Td>
								<Text
									size="sm"
									c={responseTimeColor(l.status)}
									style={{ whiteSpace: "nowrap" }}
								>
									{formatMs(l.lastResponseMs)}
								</Text>
							</Table.Td>
							<Table.Td style={{ whiteSpace: "nowrap" }}>
								{formatDateTime(l.lastCheckedAt)}
							</Table.Td>
							<Table.Td>
								<DeleteButton id={l.id} />
							</Table.Td>
						</Table.Tr>
					))}
				</Table.Tbody>
			</Table>
		</Table.ScrollContainer>
	);
}
