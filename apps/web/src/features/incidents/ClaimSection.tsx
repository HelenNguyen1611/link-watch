"use client";

import type { ClaimTimelineItem, IncidentDetail } from "@linkwatch/core";
import {
	Button,
	Group,
	Stack,
	Text,
	Textarea,
	Timeline,
	Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/lib/api";
import { useApi } from "@/lib/api-context";
import { COLOR, PALETTE } from "@/lib/colors";
import { formatDateTime } from "@/lib/format";

/** FR-41: report incidents as fixed from the app; returns a mutation shared by the screens. */
export function useResolveClaims(onDone?: () => void) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ ids, note }: { ids: string[]; note?: string }) =>
			api.resolveClaims(ids, note),
		onSuccess: (res) => {
			const count = (d: string) =>
				res.items.filter((i) => i.decision === d).length;
			const started = count("started");
			// Started > already being checked > already recovered (nothing to do).
			const message =
				started > 0
					? t("claims.started", { count: started })
					: count("in_progress") > 0
						? t("claims.inProgress")
						: t("claims.recovered");
			notifications.show({ color: PALETTE.success, message });
			void queryClient.invalidateQueries({ queryKey: ["incident"] });
			void queryClient.invalidateQueries({ queryKey: ["incidents"] });
			void queryClient.invalidateQueries({ queryKey: ["link-history"] });
			onDone?.();
		},
		onError: (err) => {
			if (err instanceof ApiError && err.status === 401) return;
			notifications.show({
				color: PALETTE.danger,
				message: t("claims.failed"),
			});
		},
	});
}

function TimelineItem({ c }: { c: ClaimTimelineItem }) {
	const { t } = useTranslation();
	return (
		<Stack gap={2}>
			<Text size="sm">
				{t("claims.by", {
					by: c.byEmail,
					channel: t(`claims.channel.${c.channel}`),
					at: formatDateTime(c.claimedAt),
				})}
			</Text>
			{c.note && (
				<Text size="sm" c="dimmed">
					“{c.note}”
				</Text>
			)}
			<Text
				size="sm"
				c={
					c.outcome === "fixed"
						? COLOR.success
						: c.outcome === "still_failing"
							? COLOR.danger
							: undefined
				}
			>
				{t(`claims.outcome.${c.outcome}`)}
				{c.attempts.length > 0 &&
					` — ${c.attempts
						.map(
							(a) =>
								`${t("claims.attempt", { n: a.attempt })}: ${t(`status.${a.result}`)}${a.httpCode ? ` ${a.httpCode}` : ""}`,
						)
						.join(", ")}`}
			</Text>
		</Stack>
	);
}

/** FR-41: report fixed + timeline of every claim on the incident. */
export function ClaimSection({ incident }: { incident: IncidentDetail }) {
	const { t } = useTranslation();
	const [note, setNote] = useState("");
	const resolve = useResolveClaims(() => setNote(""));
	const pending = incident.claims.some((c) => c.outcome === "pending");
	return (
		<Stack gap="sm">
			<Title order={3} fz="md">
				{t("claims.title")}
			</Title>
			{incident.claimNote && (
				<Text size="sm" c={COLOR.danger}>
					{incident.claimNote}
				</Text>
			)}
			{incident.state !== "closed" && !pending && (
				<Stack gap="xs" maw={640}>
					<Text size="sm" c="dimmed">
						{t("claims.hint")}
					</Text>
					<Textarea
						label={t("claims.note")}
						rows={2}
						maxLength={1000}
						value={note}
						onChange={(e) => setNote(e.currentTarget.value)}
					/>
					<Group>
						<Button
							variant="light"
							loading={resolve.isPending}
							onClick={() => resolve.mutate({ ids: [incident.id], note })}
						>
							{t("claims.button")}
						</Button>
					</Group>
				</Stack>
			)}
			{pending && (
				<Text size="sm" c="dimmed">
					{t("claims.verifying")}
				</Text>
			)}
			{incident.claims.length === 0 ? (
				<Text size="sm" c="dimmed">
					{t("claims.none")}
				</Text>
			) : (
				<Timeline
					bulletSize={14}
					lineWidth={2}
					aria-label={t("claims.timeline")}
				>
					{incident.claims.map((c) => (
						<Timeline.Item key={c.claimedAt}>
							<TimelineItem c={c} />
						</Timeline.Item>
					))}
				</Timeline>
			)}
		</Stack>
	);
}
