"use client";

import type { ScheduleView } from "@linkwatch/core";
import {
	Alert,
	Badge,
	Button,
	Group,
	Loader,
	Table,
	Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { IconPlus, IconTrash } from "@/components/icons";
import { PageHeader } from "@/components/PageHeader";
import { ApiError } from "@/lib/api";
import { useApi } from "@/lib/api-context";
import { PALETTE } from "@/lib/colors";
import { describeRule } from "./describe";
import { ScheduleDialog } from "./ScheduleDialog";

function DeleteSchedule({ schedule }: { schedule: ScheduleView }) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [confirming, setConfirming] = useState(false);
	const remove = useMutation({
		mutationFn: () => api.deleteSchedule(schedule.id),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["schedules"] });
			notifications.show({
				color: PALETTE.success,
				message: t("schedules.deleted"),
			});
		},
		onError: (err) => {
			setConfirming(false);
			if (err instanceof ApiError && err.status === 409) {
				const used = (err.body.usedBy ?? {}) as {
					domains?: number;
					links?: number;
				};
				notifications.show({
					color: "yellow",
					message: t("schedules.inUse", {
						domains: used.domains ?? 0,
						links: used.links ?? 0,
					}),
				});
			}
		},
	});
	return (
		<Button
			size="xs"
			variant={confirming ? "filled" : "subtle"}
			color={PALETTE.danger}
			leftSection={<IconTrash size={14} />}
			loading={remove.isPending}
			onClick={() => (confirming ? remove.mutate() : setConfirming(true))}
			onBlur={() => setConfirming(false)}
			aria-label={`${t(confirming ? "schedules.confirmDelete" : "schedules.delete")} ${schedule.name}`}
		>
			{t(confirming ? "schedules.confirmDelete" : "schedules.delete")}
		</Button>
	);
}

/** SCR-06: schedule templates (FR-11, FR-12, FR-13). */
export function SchedulesPage() {
	const { t } = useTranslation();
	const api = useApi();
	const query = useQuery({
		queryKey: ["schedules"],
		queryFn: () => api.listSchedules(),
	});
	const [editing, setEditing] = useState<ScheduleView | null | undefined>(
		undefined,
	);
	const unauthorized =
		query.error instanceof ApiError && query.error.status === 401;

	return (
		<>
			<PageHeader
				title={t("nav.schedules")}
				description={t("schedules.subtitle")}
				action={
					<Button
						variant="light"
						leftSection={<IconPlus size={18} />}
						onClick={() => setEditing(null)}
					>
						{t("schedules.new")}
					</Button>
				}
				mb={24}
			/>
			{query.isPending ? (
				<Loader />
			) : query.isError ? (
				unauthorized ? null : (
					<Alert color={PALETTE.danger} variant="light">
						{t("schedules.loadError")}
					</Alert>
				)
			) : (
				<Table.ScrollContainer minWidth={640}>
					<Table verticalSpacing="sm" borderColor="gray.2" highlightOnHover>
						<Table.Thead>
							<Table.Tr>
								{["name", "rule", "usedBy"].map((k) => (
									<Table.Th key={k} c="dimmed" fz="xs" fw={400}>
										{t(`schedules.col.${k}`)}
									</Table.Th>
								))}
								<Table.Th />
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{query.data.items.map((s) => (
								<Table.Tr key={s.id}>
									<Table.Td>
										<Group gap="xs">
											<Text size="sm" fw={500}>
												{s.id === "default" ? t("schedules.default") : s.name}
											</Text>
											{s.id === "default" && (
												<Badge size="xs" variant="light">
													{t("schedules.defaultBadge")}
												</Badge>
											)}
										</Group>
									</Table.Td>
									<Table.Td>{describeRule(s.rule, t)}</Table.Td>
									<Table.Td>
										<Text size="sm" c="dimmed">
											{s.id === "default"
												? t("schedules.defaultHint")
												: t("schedules.usedBy", {
														domains: s.usedBy?.domains ?? 0,
														links: s.usedBy?.links ?? 0,
													})}
										</Text>
									</Table.Td>
									<Table.Td>
										<Group gap={4} wrap="nowrap" justify="flex-end">
											<Button
												size="xs"
												variant="subtle"
												onClick={() => setEditing(s)}
												aria-label={`${t("schedules.edit")} ${s.id === "default" ? t("schedules.default") : s.name}`}
											>
												{t("schedules.edit")}
											</Button>
											{s.id !== "default" && <DeleteSchedule schedule={s} />}
										</Group>
									</Table.Td>
								</Table.Tr>
							))}
						</Table.Tbody>
					</Table>
				</Table.ScrollContainer>
			)}
			<ScheduleDialog
				schedule={editing}
				onClose={() => setEditing(undefined)}
			/>
		</>
	);
}
