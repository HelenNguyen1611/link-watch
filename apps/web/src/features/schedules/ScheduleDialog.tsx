"use client";

import {
	INTERVAL_MINUTES,
	ScheduleRule,
	type ScheduleRuleInput,
	type ScheduleView,
} from "@linkwatch/core";
import {
	Button,
	Chip,
	Group,
	Modal,
	SegmentedControl,
	Select,
	SimpleGrid,
	Stack,
	Text,
	TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "@/lib/api-context";
import { COLOR, PALETTE } from "@/lib/colors";

type Kind = ScheduleRuleInput["kind"];
type Draft = {
	name: string;
	kind: Kind;
	minutes: number;
	at: string;
	weekdays: string[];
	monthDays: string[];
};

const fromView = (s: ScheduleView | null): Draft => {
	const r = s?.rule;
	return {
		name: s?.name ?? "",
		kind: r?.kind ?? "daily",
		minutes: r?.kind === "interval" ? r.minutes : 15,
		at: r && r.kind !== "interval" ? r.at : "06:00",
		weekdays: r?.kind === "weekly" ? r.days.map(String) : ["1"],
		monthDays: r?.kind === "monthly" ? r.days.map(String) : ["1"],
	};
};

const toRule = (d: Draft): ScheduleRuleInput => {
	switch (d.kind) {
		case "interval":
			return { kind: "interval", minutes: d.minutes as 5 };
		case "daily":
			return { kind: "daily", at: d.at };
		case "weekly":
			return { kind: "weekly", days: d.weekdays.map(Number), at: d.at };
		case "monthly":
			return { kind: "monthly", days: d.monthDays.map(Number), at: d.at };
	}
};

/** FR-11 / FR-12: create or edit a schedule template. `schedule` undefined = closed, null = new. */
export function ScheduleDialog({
	schedule,
	onClose,
}: {
	schedule: ScheduleView | null | undefined;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const opened = schedule !== undefined;
	const isNew = schedule === null;
	const title = t(
		isNew ? "schedules.dialog.newTitle" : "schedules.dialog.editTitle",
	);
	return (
		<Modal opened={opened} onClose={onClose} title={title} size="lg">
			{opened && (
				<ScheduleForm
					key={schedule?.id ?? "new"}
					schedule={schedule}
					onClose={onClose}
				/>
			)}
		</Modal>
	);
}

function ScheduleForm({
	schedule,
	onClose,
}: {
	schedule: ScheduleView | null;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [draft, setDraft] = useState<Draft>(() => fromView(schedule));
	const [errors, setErrors] = useState<Record<string, string>>({});
	const isDefault = schedule?.id === "default";
	const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

	const save = useMutation({
		mutationFn: (input: { name: string; rule: ScheduleRuleInput }) =>
			schedule
				? api.updateSchedule(schedule.id, input)
				: api.createSchedule(input),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["schedules"] });
			notifications.show({
				color: PALETTE.success,
				message: t("schedules.saved"),
			});
			onClose();
		},
		onError: () => setErrors({ root: t("schedules.errors.failed") }),
	});

	const submit = (e: React.FormEvent) => {
		e.preventDefault();
		const next: Record<string, string> = {};
		const name = draft.name.trim();
		if (!name || name.length > 100) next.name = t("schedules.errors.name");
		const rule = ScheduleRule.safeParse(toRule(draft));
		if (!rule.success)
			for (const issue of rule.error.issues)
				next[issue.path[0] === "days" ? "days" : "at"] = t(
					issue.path[0] === "days"
						? "schedules.errors.days"
						: "schedules.errors.time",
				);
		setErrors(next);
		if (Object.keys(next).length > 0) return;
		save.mutate({ name, rule: toRule(draft) });
	};

	return (
		<form onSubmit={submit} noValidate>
			<Stack gap="md">
				<TextInput
					label={t("schedules.dialog.name")}
					value={draft.name}
					onChange={(e) => set({ name: e.currentTarget.value })}
					error={errors.name}
					required
				/>
				<Stack gap={4}>
					<Text size="sm" fw={500}>
						{t("schedules.dialog.kind")}
					</Text>
					<SegmentedControl
						value={draft.kind}
						onChange={(v) => set({ kind: v as Kind })}
						data={(["interval", "daily", "weekly", "monthly"] as const).map(
							(k) => ({
								value: k,
								label: t(`schedules.dialog.kinds.${k}`),
							}),
						)}
					/>
				</Stack>
				{draft.kind === "interval" ? (
					<Select
						label={t("schedules.dialog.interval")}
						data={INTERVAL_MINUTES.map((m) => ({
							value: String(m),
							label: t(`schedules.intervals.${m}`),
						}))}
						value={String(draft.minutes)}
						onChange={(v) => set({ minutes: Number(v ?? 15) })}
						allowDeselect={false}
						maw={240}
					/>
				) : (
					<TextInput
						type="time"
						label={t("schedules.dialog.at")}
						value={draft.at}
						onChange={(e) => set({ at: e.currentTarget.value })}
						error={errors.at}
						maw={200}
					/>
				)}
				{draft.kind === "weekly" && (
					<Stack gap={4}>
						<Text size="sm" fw={500}>
							{t("schedules.dialog.weekdays")}
						</Text>
						<Chip.Group
							multiple
							value={draft.weekdays}
							onChange={(v) => set({ weekdays: v })}
						>
							<Group
								gap={6}
								role="group"
								aria-label={t("schedules.dialog.weekdays")}
							>
								{[1, 2, 3, 4, 5, 6, 7].map((d) => (
									<Chip key={d} value={String(d)} size="xs" variant="outline">
										{t(`schedules.weekdays.${d}`)}
									</Chip>
								))}
							</Group>
						</Chip.Group>
					</Stack>
				)}
				{draft.kind === "monthly" && (
					<Stack gap={4}>
						<Text size="sm" fw={500}>
							{t("schedules.dialog.monthDays")}
						</Text>
						<Chip.Group
							multiple
							value={draft.monthDays}
							onChange={(v) => set({ monthDays: v })}
						>
							<SimpleGrid
								cols={7}
								spacing={4}
								role="group"
								aria-label={t("schedules.dialog.monthDays")}
							>
								{Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
									<Chip key={d} value={String(d)} size="xs" variant="outline">
										{d}
									</Chip>
								))}
							</SimpleGrid>
						</Chip.Group>
						<Text size="xs" c="dimmed">
							{t("schedules.dialog.monthDaysHint")}
						</Text>
					</Stack>
				)}
				{errors.days && (
					<Text size="sm" c={COLOR.danger} role="alert">
						{errors.days}
					</Text>
				)}
				{isDefault && (
					<Text size="xs" c="dimmed">
						{t("schedules.defaultHint")}
					</Text>
				)}
				{errors.root && (
					<Text size="sm" c={COLOR.danger} role="alert">
						{errors.root}
					</Text>
				)}
				<Group justify="flex-end" gap="xs">
					<Button variant="subtle" color="gray" onClick={onClose}>
						{t("schedules.dialog.cancel")}
					</Button>
					<Button type="submit" variant="light" loading={save.isPending}>
						{t("schedules.dialog.save")}
					</Button>
				</Group>
			</Stack>
		</form>
	);
}
