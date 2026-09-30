"use client";

import type { LinkView } from "@linkwatch/core";
import { Alert, Box, Group, Loader, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/PageHeader";
import { ApiError } from "@/lib/api";
import { useApi } from "@/lib/api-context";
import { PALETTE } from "@/lib/colors";
import { AddLinkForm } from "./AddLinkForm";
import { EMPTY_FILTER, filterLinks, type LinkFilter } from "./filter";
import { LinkFilters } from "./LinkFilters";
import { LinkTable } from "./LinkTable";

/** Auto-refresh to pick up new check results (the Dispatcher runs every 5 minutes). */
export const REFRESH_MS = 30_000;
const MAX_PAGES = 20;

/** Milestone 1: link list + add form (reduced from SCR-03/SCR-04). */
export function LinksPage() {
	const { t } = useTranslation();
	const api = useApi();
	const links = useQuery({
		queryKey: ["links"],
		queryFn: async () => {
			const all: LinkView[] = [];
			let cursor: string | null = null;
			for (let i = 0; i < MAX_PAGES; i++) {
				const page = await api.listLinks({ cursor });
				all.push(...page.items);
				cursor = page.cursor;
				if (!cursor) break;
			}
			return all;
		},
		refetchInterval: REFRESH_MS,
	});

	const [filter, setFilter] = useState<LinkFilter>(EMPTY_FILTER);
	const all = links.data ?? [];
	const shown = useMemo(() => filterLinks(all, filter), [all, filter]);

	// 401: the API client signs out and the gate shows the sign-in page; no error box.
	const unauthorized =
		links.error instanceof ApiError && links.error.status === 401;

	return (
		<>
			<PageHeader
				title={t("links.title")}
				description={t("links.subtitle")}
				mb={24}
			/>
			<Box pb={40}>
				<AddLinkForm />
			</Box>
			<Group justify="space-between" mb="xs">
				<Text size="sm" c="dimmed">
					{t("links.refreshNote")}
				</Text>
				{links.isFetching && <Loader size="xs" />}
			</Group>
			{links.isPending ? (
				<Loader />
			) : links.isError && !unauthorized ? (
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
						/>
					)}
					<LinkTable
						links={shown}
						emptyText={all.length > 0 ? t("links.noMatch") : undefined}
					/>
				</>
			)}
		</>
	);
}
