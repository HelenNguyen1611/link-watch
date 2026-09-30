"use client";

import { Alert, Button, Group, Loader, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconRefresh } from "@/components/icons";
import { PageHeader } from "@/components/PageHeader";
import { ApiError } from "@/lib/api";
import { useApi } from "@/lib/api-context";
import { PALETTE } from "@/lib/colors";
import { formatClock } from "@/lib/format";
import { AddLinkForm } from "./AddLinkForm";
import {
	EMPTY_FILTER,
	filterLinks,
	filterOptions,
	type LinkFilter,
} from "./filter";
import { ImportDialog } from "./ImportDialog";
import { LinkFilters } from "./LinkFilters";
import { LinkTable } from "./LinkTable";
import { LinksDataProvider, useLinksData } from "./links-data";

/** FR-05: download the CSV built by the API (it needs the Bearer token, so no plain link). */
function ExportButton() {
	const { t } = useTranslation();
	const api = useApi();
	const exportCsv = useMutation({
		mutationFn: () => api.exportCsv(),
		onSuccess: (csv) => {
			const url = URL.createObjectURL(
				new Blob([csv], { type: "text/csv;charset=utf-8" }),
			);
			const a = document.createElement("a");
			a.href = url;
			a.download = `linkwatch-links-${new Date().toISOString().slice(0, 10)}.csv`;
			a.click();
			URL.revokeObjectURL(url);
		},
		onError: (err) => {
			if (err instanceof ApiError && err.status === 401) return;
			notifications.show({
				color: PALETTE.danger,
				message: t("links.exportFailed"),
			});
		},
	});
	return (
		<Button
			size="xs"
			variant="subtle"
			loading={exportCsv.isPending}
			onClick={() => exportCsv.mutate()}
		>
			{t("links.export")}
		</Button>
	);
}

function LinksContent() {
	const { t } = useTranslation();
	const data = useLinksData();
	const [filter, setFilter] = useState<LinkFilter>(EMPTY_FILTER);
	const [importing, setImporting] = useState(false);
	const all = data?.rows ?? [];
	const shown = useMemo(() => filterLinks(all, filter), [all, filter]);
	const options = useMemo(() => filterOptions(all), [all]);
	if (!data) return null;

	// 401: the API client signs out and the gate shows the sign-in page; no error box.
	const unauthorized =
		data.error instanceof ApiError && data.error.status === 401;

	return (
		<>
			<Group justify="space-between" mb="xs" gap="xs">
				<Text size="xs" c="dimmed">
					{t(data.waiting ? "links.refresh.fast" : "links.refresh.slow")}
				</Text>
				<Group gap="xs">
					{data.updatedAt > 0 && (
						<Text size="xs" c="dimmed">
							{t("links.refresh.updated", {
								time: formatClock(data.updatedAt),
							})}
						</Text>
					)}
					<Button size="xs" variant="subtle" onClick={() => setImporting(true)}>
						{t("links.import")}
					</Button>
					<ExportButton />
					<Button
						size="xs"
						variant="subtle"
						leftSection={<IconRefresh size={16} />}
						loading={data.isFetching}
						onClick={data.refresh}
					>
						{t("links.refresh.button")}
					</Button>
				</Group>
			</Group>
			<ImportDialog opened={importing} onClose={() => setImporting(false)} />
			{data.isPending ? (
				<Loader />
			) : data.error && !unauthorized ? (
				<Alert color={PALETTE.danger} variant="light">
					{t("links.loadError")}
				</Alert>
			) : (
				<>
					{all.length > 0 && (
						<LinkFilters
							onChange={setFilter}
							shown={shown.length}
							total={all.length}
							domains={options.domains}
							tags={options.tags}
						/>
					)}
					<LinkTable
						links={shown}
						emptyText={all.length > 0 ? t("links.noMatch") : undefined}
						resetKey={JSON.stringify(filter)}
					/>
				</>
			)}
		</>
	);
}

/** SCR-03: link list from the snapshot (step 19b) + add form, filters, bulk actions. */
export function LinksPage() {
	const { t } = useTranslation();
	return (
		<LinksDataProvider>
			<PageHeader
				title={t("links.title")}
				description={t("links.subtitle")}
				action={<AddLinkForm />}
				mb={32}
			/>
			<LinksContent />
		</LinksDataProvider>
	);
}
