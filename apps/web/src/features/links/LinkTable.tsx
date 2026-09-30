"use client";

import type { LinkView } from "@linkwatch/core";
import {
	Anchor,
	Button,
	Group,
	Stack,
	Table,
	Text,
	UnstyledButton,
} from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import NextLink from "next/link";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	IconArrowDown,
	IconArrowUp,
	IconSelector,
	IconTrash,
} from "@/components/icons";
import { useApi } from "@/lib/api-context";
import { PALETTE } from "@/lib/colors";
import { formatDateTime, formatMs } from "@/lib/format";
import { StatusBadge } from "./StatusBadge";
import { nextSort, type SortKey, type SortState, sortLinks } from "./sort";
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

/** Header label that toggles sorting; the icon shows the current direction. */
function SortLabel({
	column,
	sort,
	onSort,
}: {
	column: SortKey;
	sort: SortState;
	onSort: (key: SortKey) => void;
}) {
	const { t } = useTranslation();
	const active = sort?.key === column ? sort.dir : undefined;
	const Icon =
		active === "asc"
			? IconArrowUp
			: active === "desc"
				? IconArrowDown
				: IconSelector;
	const label = t(`links.col.${column}`);
	return (
		<UnstyledButton
			onClick={() => onSort(column)}
			aria-label={t("links.sortBy", { column: label })}
			fz="xs"
			c={active ? undefined : "dimmed"}
			fw={active ? 500 : 400}
		>
			<Group gap={4} wrap="nowrap">
				<span>{label}</span>
				<Icon size={14} style={{ opacity: active ? 1 : 0.5 }} />
			</Group>
		</UnstyledButton>
	);
}

const ariaSort = (sort: SortState, column: SortKey) =>
	sort?.key === column
		? sort.dir === "asc"
			? "ascending"
			: "descending"
		: "none";

/** FR-17: status, HTTP code, response time and last check of each link; every column sorts. */
export function LinkTable({
	links,
	emptyText,
}: {
	links: LinkView[];
	/** Shown instead of the default "no links yet" text, e.g. when filters match nothing. */
	emptyText?: string;
}) {
	const { t } = useTranslation();
	const [sort, setSort] = useState<SortState>(null);
	const rows = useMemo(() => sortLinks(links, sort), [links, sort]);
	if (links.length === 0)
		return <Text c="dimmed">{emptyText ?? t("links.empty")}</Text>;
	const onSort = (key: SortKey) => setSort((s) => nextSort(s, key));
	const th = (key: SortKey) => (
		<Table.Th
			c="dimmed"
			fz="xs"
			fw={400}
			style={{ whiteSpace: "nowrap" }}
			aria-sort={ariaSort(sort, key)}
		>
			<SortLabel column={key} sort={sort} onSort={onSort} />
		</Table.Th>
	);
	return (
		// Scrolls both ways inside the viewport so the header row and URL column stay pinned.
		<Table.ScrollContainer
			minWidth={920}
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
							aria-sort={ariaSort(sort, "url")}
						>
							<SortLabel column="url" sort={sort} onSort={onSort} />
						</Table.Th>
						{th("status")}
						{th("domain")}
						{th("http")}
						{th("responseTime")}
						{th("lastChecked")}
						{th("added")}
						<Table.Th />
					</Table.Tr>
				</Table.Thead>
				<Table.Tbody>
					{rows.map((l) => (
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
									<Group gap={6} wrap="nowrap">
										{l.name && (
											<Text size="xs" c="dimmed" truncate>
												{l.name}
											</Text>
										)}
										<Anchor
											component={NextLink}
											href={`/links/detail/?id=${encodeURIComponent(l.id)}`}
											size="xs"
											aria-label={t("links.detailsFor", { url: l.url })}
										>
											{t("links.details")}
										</Anchor>
									</Group>
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
							<Table.Td style={{ whiteSpace: "nowrap" }}>
								{formatDateTime(l.createdAt)}
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
