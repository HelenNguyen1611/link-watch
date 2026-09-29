"use client";

import type { LinkView } from "@linkwatch/core";
import { Alert, Box, Group, Loader, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/PageHeader";
import { ApiError } from "@/lib/api";
import { useApi } from "@/lib/api-context";
import { AddLinkForm } from "./AddLinkForm";
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

	const unauthorized =
		links.error instanceof ApiError && links.error.status === 401;
	useEffect(() => {
		if (unauthorized)
			window.dispatchEvent(new Event("linkwatch:api-key-invalid"));
	}, [unauthorized]);

	return (
		<>
			<PageHeader title={t("links.title")} description={t("links.subtitle")} />
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
				<Alert color="red" variant="light">
					{t("links.loadError")}
				</Alert>
			) : (
				<LinkTable links={links.data ?? []} />
			)}
		</>
	);
}
