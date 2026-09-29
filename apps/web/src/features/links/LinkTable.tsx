"use client";

import type { LinkView } from "@linkwatch/core";
import { Anchor, Button, Stack, Table, Text } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "@/lib/api-context";
import { formatDateTime, formatMs } from "@/lib/format";
import { StatusBadge } from "./StatusBadge";

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
			color="red"
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
			color="gray"
			onClick={() => setConfirming(true)}
		>
			{t("links.delete")}
		</Button>
	);
}

/** FR-17: trạng thái, mã HTTP, thời gian phản hồi, lần check gần nhất của từng link. */
export function LinkTable({ links }: { links: LinkView[] }) {
	const { t } = useTranslation();
	if (links.length === 0) return <Text c="dimmed">{t("links.empty")}</Text>;
	return (
		<Table.ScrollContainer minWidth={760}>
			<Table
				highlightOnHover
				verticalSpacing="md"
				horizontalSpacing="sm"
				borderColor="gray.2"
			>
				<Table.Thead>
					<Table.Tr>
						<Table.Th c="dimmed" fz="xs" fw={400}>
							{t("links.col.url")}
						</Table.Th>
						<Table.Th c="dimmed" fz="xs" fw={400}>
							{t("links.col.domain")}
						</Table.Th>
						<Table.Th c="dimmed" fz="xs" fw={400}>
							{t("links.col.status")}
						</Table.Th>
						<Table.Th c="dimmed" fz="xs" fw={400}>
							{t("links.col.http")}
						</Table.Th>
						<Table.Th c="dimmed" fz="xs" fw={400}>
							{t("links.col.responseTime")}
						</Table.Th>
						<Table.Th c="dimmed" fz="xs" fw={400}>
							{t("links.col.lastChecked")}
						</Table.Th>
						<Table.Th />
					</Table.Tr>
				</Table.Thead>
				<Table.Tbody>
					{links.map((l) => (
						<Table.Tr key={l.id}>
							<Table.Td>
								<Stack gap={0}>
									<Anchor
										href={l.url}
										target="_blank"
										rel="noopener noreferrer"
										size="sm"
										style={{ wordBreak: "break-all" }}
									>
										{l.url}
									</Anchor>
									{l.name && (
										<Text size="xs" c="dimmed">
											{l.name}
										</Text>
									)}
								</Stack>
							</Table.Td>
							<Table.Td>{l.domain}</Table.Td>
							<Table.Td>
								<Stack gap={2} align="flex-start">
									<StatusBadge status={l.status} />
									{l.lastErrorType && (
										<Text size="xs" c="dimmed">
											{t(`errorType.${l.lastErrorType}`)}
										</Text>
									)}
								</Stack>
							</Table.Td>
							<Table.Td>{l.lastHttpCode ?? "—"}</Table.Td>
							<Table.Td>{formatMs(l.lastResponseMs)}</Table.Td>
							<Table.Td>{formatDateTime(l.lastCheckedAt)}</Table.Td>
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
