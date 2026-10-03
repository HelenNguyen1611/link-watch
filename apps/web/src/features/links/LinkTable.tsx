"use client";

import type { LinkView } from "@linkwatch/core";
import {
	Anchor,
	Button,
	Checkbox,
	Group,
	Pagination,
	Select,
	Stack,
	Table,
	Text,
	UnstyledButton,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import NextLink from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	IconArrowDown,
	IconArrowUp,
	IconSelector,
	IconTrash,
} from "@/components/icons";
import { useApi } from "@/lib/api-context";
import { useCan } from "@/lib/auth-context";
import { PALETTE } from "@/lib/colors";
import { formatDateTime, formatMs } from "@/lib/format";
import { EditLinkDialog } from "./EditLinkDialog";
import { useLinksData } from "./links-data";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, paginate } from "./paginate";
import { StatusBadge } from "./StatusBadge";
import { nextSort, type SortKey, type SortState, sortLinks } from "./sort";
import { httpCodeColor, responseTimeColor } from "./status-style";
import css from "./table.module.css";

function DeleteButton({ id }: { id: string }) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [confirming, setConfirming] = useState(false);
	const data = useLinksData();
	const remove = useMutation({
		mutationFn: () => api.deleteLink(id),
		onSuccess: () => {
			data?.remove(id);
			return queryClient.invalidateQueries({ queryKey: ["links"] });
		},
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

type BulkAction = "pause" | "resume" | "check" | "delete";

/** FR-04 / FR-16: actions on the selected links. */
function BulkBar({
	selected,
	rows,
	onDone,
}: {
	selected: string[];
	rows: readonly LinkView[];
	onDone: () => void;
}) {
	const { t } = useTranslation();
	const api = useApi();
	const data = useLinksData();
	const queryClient = useQueryClient();
	const [confirmDelete, setConfirmDelete] = useState(false);
	const run = useMutation({
		mutationFn: async (action: BulkAction) => {
			if (action === "check")
				return { action, res: await api.checkNow({ linkIds: selected }) };
			return { action, res: await api.bulkLinks(action, selected) };
		},
		onSuccess: ({ action, res }) => {
			if (action === "check") {
				const r = res as { queued: string[] };
				notifications.show({
					color: PALETTE.success,
					message: t("links.bulk.checkQueued", { count: r.queued.length }),
				});
			} else {
				const r = res as { updated: string[] };
				if (action === "delete") for (const id of r.updated) data?.remove(id);
				else if (action === "pause")
					data?.patchMany(r.updated, { paused: true, nextRunAt: undefined });
				else data?.patchMany(r.updated, { paused: false });
				notifications.show({
					color: PALETTE.success,
					message: t(`links.bulk.done.${action}`, { count: r.updated.length }),
				});
				if (!data) void queryClient.invalidateQueries({ queryKey: ["links"] });
			}
			setConfirmDelete(false);
			onDone();
		},
		onError: () =>
			notifications.show({
				color: PALETTE.danger,
				message: t("links.bulk.failed"),
			}),
	});
	const anyActive = rows.some((l) => selected.includes(l.id) && !l.paused);
	const anyPaused = rows.some((l) => selected.includes(l.id) && l.paused);
	return (
		<Group gap="xs" mb="xs" role="toolbar" aria-label={t("links.bulk.label")}>
			<Text size="sm" fw={500}>
				{t("links.bulk.selected", { count: selected.length })}
			</Text>
			<Button
				size="xs"
				variant="light"
				disabled={!anyActive}
				loading={run.isPending && run.variables === "pause"}
				onClick={() => run.mutate("pause")}
			>
				{t("links.bulk.pause")}
			</Button>
			<Button
				size="xs"
				variant="light"
				disabled={!anyPaused}
				loading={run.isPending && run.variables === "resume"}
				onClick={() => run.mutate("resume")}
			>
				{t("links.bulk.resume")}
			</Button>
			<Button
				size="xs"
				variant="light"
				loading={run.isPending && run.variables === "check"}
				onClick={() => run.mutate("check")}
			>
				{t("links.bulk.check")}
			</Button>
			{confirmDelete ? (
				<Button
					size="xs"
					color={PALETTE.danger}
					leftSection={<IconTrash size={14} />}
					loading={run.isPending && run.variables === "delete"}
					onClick={() => run.mutate("delete")}
					onBlur={() => setConfirmDelete(false)}
				>
					{t("links.bulk.confirmDelete", { count: selected.length })}
				</Button>
			) : (
				<Button
					size="xs"
					variant="subtle"
					color={PALETTE.danger}
					leftSection={<IconTrash size={14} />}
					onClick={() => setConfirmDelete(true)}
				>
					{t("links.bulk.delete")}
				</Button>
			)}
			<Button size="xs" variant="subtle" color="gray" onClick={onDone}>
				{t("links.bulk.clear")}
			</Button>
		</Group>
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

/**
 * FR-04, FR-16, FR-17: status, HTTP code, response time and last check of each link; every
 * column sorts; rows are paged; selected rows get bulk actions; each row can be edited.
 */
export function LinkTable({
	links,
	emptyText,
	resetKey,
}: {
	links: LinkView[];
	/** Shown instead of the default "no links yet" text, e.g. when filters match nothing. */
	emptyText?: string;
	/** Changes when the filters change → back to page 1. */
	resetKey?: string;
}) {
	const { t } = useTranslation();
	const data = useLinksData();
	const queryClient = useQueryClient();
	const [sort, setSort] = useState<SortState>(null);
	const [page, setPage] = useState(1);
	const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
	const [selected, setSelected] = useState<string[]>([]);
	const [editing, setEditing] = useState<LinkView | null>(null);
	// HLR-09: viewers see the table without selection, edit or delete.
	const canEdit = useCan()("edit");
	const sorted = useMemo(() => sortLinks(links, sort), [links, sort]);
	const view = paginate(sorted, page, pageSize);

	// Filters changed → first page.
	// biome-ignore lint/correctness/useExhaustiveDependencies: resetKey is the trigger
	useEffect(() => setPage(1), [resetKey]);
	// Keep only selected links that still exist.
	useEffect(() => {
		const ids = new Set(links.map((l) => l.id));
		setSelected((s) =>
			s.every((id) => ids.has(id)) ? s : s.filter((id) => ids.has(id)),
		);
	}, [links]);

	if (links.length === 0)
		return <Text c="dimmed">{emptyText ?? t("links.empty")}</Text>;
	const onSort = (key: SortKey) => {
		setSort((s) => nextSort(s, key));
		setPage(1);
	};
	const pageIds = view.rows.map((l) => l.id);
	const allOnPage =
		pageIds.length > 0 && pageIds.every((id) => selected.includes(id));
	const someOnPage = pageIds.some((id) => selected.includes(id));
	const togglePage = () =>
		setSelected((s) =>
			allOnPage
				? s.filter((id) => !pageIds.includes(id))
				: [...new Set([...s, ...pageIds])],
		);
	const toggle = (id: string) =>
		setSelected((s) =>
			s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
		);
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
		<>
			{canEdit && selected.length > 0 && (
				<BulkBar
					selected={selected}
					rows={links}
					onDone={() => setSelected([])}
				/>
			)}
			{/* Scrolls both ways inside the viewport so the header row and URL column stay pinned. */}
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
								<Group gap="xs" wrap="nowrap">
									{canEdit && (
										<Checkbox
											size="xs"
											aria-label={t("links.bulk.selectPage")}
											checked={allOnPage}
											indeterminate={someOnPage && !allOnPage}
											onChange={togglePage}
										/>
									)}
									<SortLabel column="url" sort={sort} onSort={onSort} />
								</Group>
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
						{view.rows.map((l) => (
							<Table.Tr
								key={l.id}
								bg={
									selected.includes(l.id)
										? "var(--mantine-color-gray-0)"
										: undefined
								}
							>
								<Table.Td className={css.sticky} data-sticky="true">
									<Group gap="xs" wrap="nowrap" align="flex-start">
										{canEdit && (
											<Checkbox
												size="xs"
												mt={3}
												aria-label={t("links.bulk.select", { url: l.url })}
												checked={selected.includes(l.id)}
												onChange={() => toggle(l.id)}
											/>
										)}
										<Stack gap={0} style={{ minWidth: 0 }}>
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
												{l.paused && (
													<Text size="xs" c="dimmed">
														· {t("links.pausedTag")}
													</Text>
												)}
											</Group>
										</Stack>
									</Group>
								</Table.Td>
								<Table.Td>
									<Stack gap={2} align="flex-start">
										<StatusBadge status={l.status} />
										{l.lastErrorType && (
											<Text
												size="xs"
												c="dimmed"
												style={{ whiteSpace: "nowrap" }}
											>
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
									{canEdit && (
										<Group gap={4} wrap="nowrap">
											<Button
												size="xs"
												variant="subtle"
												onClick={() => setEditing(l)}
												aria-label={t("links.editFor", { url: l.url })}
											>
												{t("links.edit")}
											</Button>
											<DeleteButton id={l.id} />
										</Group>
									)}
								</Table.Td>
							</Table.Tr>
						))}
					</Table.Tbody>
				</Table>
			</Table.ScrollContainer>
			<Group justify="space-between" mt="sm" gap="sm">
				<Group gap="xs">
					<Text size="sm" c="dimmed" aria-live="polite">
						{t("links.page.showing", {
							from: view.from,
							to: view.to,
							total: view.total,
						})}
					</Text>
					<Select
						size="xs"
						w={120}
						aria-label={t("links.page.size")}
						data={PAGE_SIZES.map((n) => ({
							value: String(n),
							label: t("links.page.perPage", { count: n }),
						}))}
						value={String(pageSize)}
						onChange={(v) => {
							setPageSize(Number(v ?? DEFAULT_PAGE_SIZE));
							setPage(1);
						}}
						allowDeselect={false}
					/>
				</Group>
				{view.pages > 1 && (
					<Pagination
						size="sm"
						total={view.pages}
						value={view.page}
						onChange={setPage}
						getControlProps={(control) => ({
							"aria-label": t(`links.page.${control}`),
						})}
					/>
				)}
			</Group>
			<EditLinkDialog
				link={editing}
				onClose={() => setEditing(null)}
				onSaved={(row) => {
					if (data) data.upsert(row);
					else void queryClient.invalidateQueries({ queryKey: ["links"] });
				}}
			/>
		</>
	);
}
