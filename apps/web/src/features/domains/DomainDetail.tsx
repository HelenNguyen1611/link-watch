"use client";

import type { DomainUpdateRaw, RecipientView } from "@linkwatch/core";
import {
	Alert,
	Anchor,
	Button,
	Fieldset,
	Group,
	Loader,
	Select,
	SimpleGrid,
	Stack,
	Switch,
	Table,
	Text,
	Textarea,
	TextInput,
	Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconChevronLeft, IconTrash } from "@/components/icons";
import { UptimeBar } from "@/features/links/detail/UptimeBar";
import { describeRule } from "@/features/schedules/describe";
import { ApiError, type DomainDetailView } from "@/lib/api";
import { useApi } from "@/lib/api-context";
import { useCan } from "@/lib/auth-context";
import { COLOR, PALETTE } from "@/lib/colors";
import { formatDateTime, formatMs } from "@/lib/format";
import { scheduleLabel } from "./DomainList";
import { DomainStatusBadge } from "./DomainStatusBadge";

function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<Stack gap={2}>
			<Text size="xs" c="dimmed">
				{label}
			</Text>
			<Text size="sm" component="div">
				{children}
			</Text>
		</Stack>
	);
}

type Draft = {
	displayName: string;
	description: string;
	owner: string;
	scheduleId: string;
	enabled: boolean;
	slowAlert: boolean;
	ignoreWaf403: boolean;
};
const toDraft = (d: DomainDetailView): Draft => ({
	displayName: d.displayName ?? "",
	description: d.description ?? "",
	owner: d.owner ?? "",
	scheduleId: d.scheduleId ?? "",
	enabled: d.enabled,
	slowAlert: d.slowAlert,
	ignoreWaf403: d.ignoreWaf403,
});

/** FR-08 / FR-13 / SRS 3.4: domain settings; only changed fields are sent. */
function Settings({ domain }: { domain: DomainDetailView }) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const schedules = useQuery({
		queryKey: ["schedules"],
		queryFn: () => api.listSchedules(),
	});
	const [draft, setDraft] = useState<Draft>(() => toDraft(domain));
	// HLR-09: viewers see the settings read-only.
	const canEdit = useCan()("edit");
	const initial = toDraft(domain);
	const changes: DomainUpdateRaw = {};
	for (const k of Object.keys(draft) as (keyof Draft)[])
		if (draft[k] !== initial[k])
			(changes as Record<string, unknown>)[k] =
				k === "scheduleId" ? draft.scheduleId || null : draft[k];
	const dirty = Object.keys(changes).length > 0;
	const save = useMutation({
		mutationFn: () => api.updateDomain(domain.name, changes),
		onSuccess: (saved) => {
			queryClient.setQueryData(["domain", domain.name], saved);
			void queryClient.invalidateQueries({ queryKey: ["domains"] });
			setDraft(toDraft(saved));
			notifications.show({
				color: PALETTE.success,
				message: t("domains.saved"),
			});
		},
	});
	const error =
		save.error instanceof ApiError && save.error.status === 400
			? t("domains.errors.invalid")
			: save.error
				? t("domains.errors.failed")
				: undefined;
	const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
	return (
		<Stack gap="sm" maw={640}>
			<Title order={3} fz="md">
				{t("domains.settings")}
			</Title>
			<Fieldset
				variant="unstyled"
				disabled={!canEdit}
				aria-label={t("domains.settings")}
			>
				<Stack gap="sm">
					<TextInput
						label={t("domains.fields.displayName")}
						value={draft.displayName}
						onChange={(e) => set({ displayName: e.currentTarget.value })}
					/>
					<Textarea
						label={t("domains.fields.description")}
						rows={2}
						value={draft.description}
						onChange={(e) => set({ description: e.currentTarget.value })}
					/>
					<TextInput
						label={t("domains.fields.owner")}
						placeholder="owner@example.com"
						value={draft.owner}
						onChange={(e) => set({ owner: e.currentTarget.value })}
					/>
					<Select
						label={t("domains.fields.schedule")}
						description={t("domains.fields.scheduleHint")}
						data={[
							{ value: "", label: t("domains.defaultSchedule") },
							...(schedules.data?.items ?? [])
								.filter((s) => s.id !== "default")
								.map((s) => ({
									value: s.id,
									label: `${s.name} — ${describeRule(s.rule, t)}`,
								})),
						]}
						value={draft.scheduleId}
						onChange={(v) => set({ scheduleId: v ?? "" })}
						allowDeselect={false}
					/>
					<Switch
						label={t("domains.fields.enabled")}
						description={t("domains.fields.enabledHint")}
						checked={draft.enabled}
						onChange={(e) => set({ enabled: e.currentTarget.checked })}
					/>
					<Switch
						label={t("domains.fields.slowAlert")}
						description={t("domains.fields.slowAlertHint")}
						checked={draft.slowAlert}
						onChange={(e) => set({ slowAlert: e.currentTarget.checked })}
					/>
					<Switch
						label={t("domains.fields.ignoreWaf403")}
						description={t("domains.fields.ignoreWaf403Hint")}
						checked={draft.ignoreWaf403}
						onChange={(e) => set({ ignoreWaf403: e.currentTarget.checked })}
					/>
				</Stack>
			</Fieldset>
			{error && (
				<Text size="sm" c={COLOR.danger} role="alert">
					{error}
				</Text>
			)}
			{canEdit && (
				<Group gap="xs">
					<Button
						variant="light"
						disabled={!dirty}
						loading={save.isPending}
						onClick={() => save.mutate()}
					>
						{t("domains.save")}
					</Button>
					{dirty && (
						<Button
							variant="subtle"
							color="gray"
							onClick={() => setDraft(initial)}
						>
							{t("domains.discard")}
						</Button>
					)}
				</Group>
			)}
		</Stack>
	);
}

/** FR-20: recipients of the domain. */
function Recipients({ domain }: { domain: string }) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const key = ["recipients", "DOMAIN", domain];
	const list = useQuery({
		queryKey: key,
		queryFn: () => api.listRecipients("DOMAIN", domain),
	});
	const [email, setEmail] = useState("");
	const [name, setName] = useState("");
	const canEdit = useCan()("edit");
	const add = useMutation({
		mutationFn: () =>
			api.addRecipient({
				scope: "DOMAIN",
				target: domain,
				email,
				...(name.trim() && { name }),
			}),
		onSuccess: () => {
			setEmail("");
			setName("");
			void queryClient.invalidateQueries({ queryKey: key });
		},
	});
	const remove = useMutation({
		mutationFn: (r: RecipientView) =>
			api.removeRecipient("DOMAIN", domain, r.email),
		onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
	});
	const addError =
		add.error instanceof ApiError && add.error.status === 409
			? t("domains.recipients.duplicate")
			: add.error instanceof ApiError && add.error.status === 400
				? t("domains.recipients.invalid")
				: add.error
					? t("domains.errors.failed")
					: undefined;
	return (
		<Stack gap="sm" maw={640}>
			<Title order={3} fz="md">
				{t("domains.recipients.title")}
			</Title>
			<Text size="sm" c="dimmed">
				{t("domains.recipients.hint")}
			</Text>
			{list.data?.items.length === 0 && (
				<Text size="sm" c="dimmed">
					{t("domains.recipients.none")}
				</Text>
			)}
			{(list.data?.items.length ?? 0) > 0 && (
				<Table verticalSpacing={4} aria-label={t("domains.recipients.title")}>
					<Table.Tbody>
						{list.data?.items.map((r) => (
							<Table.Tr key={r.email}>
								<Table.Td>{r.email}</Table.Td>
								<Table.Td c="dimmed">{r.name ?? ""}</Table.Td>
								<Table.Td w={1}>
									{canEdit && (
										<Button
											size="xs"
											variant="subtle"
											color={PALETTE.danger}
											leftSection={<IconTrash size={14} />}
											onClick={() => remove.mutate(r)}
											aria-label={t("domains.recipients.removeFor", {
												email: r.email,
											})}
										>
											{t("domains.recipients.remove")}
										</Button>
									)}
								</Table.Td>
							</Table.Tr>
						))}
					</Table.Tbody>
				</Table>
			)}
			{canEdit && (
				<Group align="flex-end" gap="xs" wrap="wrap">
					<TextInput
						label={t("domains.recipients.email")}
						value={email}
						onChange={(e) => setEmail(e.currentTarget.value)}
						error={addError}
						style={{ flex: "1 1 220px" }}
					/>
					<TextInput
						label={t("domains.recipients.name")}
						value={name}
						onChange={(e) => setName(e.currentTarget.value)}
						style={{ flex: "1 1 160px" }}
					/>
					<Button
						variant="light"
						disabled={!email.trim()}
						loading={add.isPending}
						onClick={() => add.mutate()}
					>
						{t("domains.recipients.add")}
					</Button>
				</Group>
			)}
		</Stack>
	);
}

/** SCR-02 detail: `/domains/?d=<name>` (FR-08, FR-10, FR-13, FR-20). */
export function DomainDetail({ name }: { name: string }) {
	const { t } = useTranslation();
	const api = useApi();
	const domain = useQuery({
		queryKey: ["domain", name],
		queryFn: () => api.getDomain(name),
	});
	const schedules = useQuery({
		queryKey: ["schedules"],
		queryFn: () => api.listSchedules(),
	});
	const back = (
		<Anchor component={Link} href="/domains/" size="sm" c="dimmed">
			<Group gap={4}>
				<IconChevronLeft size={16} />
				{t("domains.back")}
			</Group>
		</Anchor>
	);
	if (domain.isPending)
		return (
			<Stack>
				{back}
				<Loader />
			</Stack>
		);
	if (domain.isError) {
		if (domain.error instanceof ApiError && domain.error.status === 401)
			return null;
		const notFound =
			domain.error instanceof ApiError && domain.error.status === 404;
		return (
			<Stack>
				{back}
				<Alert color={PALETTE.danger} variant="light">
					{t(notFound ? "domains.notFound" : "domains.loadError")}
				</Alert>
			</Stack>
		);
	}
	const d = domain.data;
	return (
		<Stack gap={32} maw={1100}>
			{back}
			<Stack gap={6}>
				<Group gap="xs">
					<DomainStatusBadge status={d.status} />
					{!d.enabled && (
						<Text size="sm" c="dimmed">
							{t("domains.disabled")}
						</Text>
					)}
				</Group>
				<Title order={2} fz="lg">
					{d.displayName ?? d.name}
				</Title>
				{d.displayName && (
					<Text size="sm" c="dimmed">
						{d.name}
					</Text>
				)}
				{d.description && <Text size="sm">{d.description}</Text>}
			</Stack>
			<SimpleGrid cols={{ base: 2, sm: 4 }} spacing="lg">
				<Field label={t("domains.col.links")}>
					{t("domains.linkCounts", { total: d.total, paused: d.paused })}
				</Field>
				<Field label={t("domains.col.response")}>
					{formatMs(d.avgResponseMs)}
				</Field>
				<Field label={t("domains.col.lastChecked")}>
					{formatDateTime(d.lastCheckedAt)}
				</Field>
				<Field label={t("domains.col.nextCheck")}>
					{formatDateTime(d.nextRunAt)}
				</Field>
				<Field label={t("domains.uptime7")}>
					{d.uptime7 === undefined ? "—" : `${d.uptime7}%`}
				</Field>
				<Field label={t("domains.col.schedule")}>
					{scheduleLabel(d.schedule, schedules.data?.items, t)}
				</Field>
				<Field label={t("domains.fields.owner")}>{d.owner ?? "—"}</Field>
			</SimpleGrid>
			<UptimeBar uptime={d.uptimeDays} />
			<Settings key={JSON.stringify(toDraft(d))} domain={d} />
			<Recipients domain={d.name} />
		</Stack>
	);
}
