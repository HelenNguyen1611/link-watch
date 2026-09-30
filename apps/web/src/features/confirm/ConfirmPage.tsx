"use client";

import {
	Alert,
	Button,
	Card,
	Center,
	Group,
	Loader,
	Stack,
	Text,
	Textarea,
	Title,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { Logo } from "@/components/Logo";
import type { ClaimViewDto, TokenClaimView } from "@/lib/api";
import { useApi } from "@/lib/api-context";
import { COLOR, PALETTE } from "@/lib/colors";
import { formatDateTime } from "@/lib/format";

/** FR-39: refresh every 3 seconds until the 3 checks are done. */
export const CONFIRM_POLL_MS = 3_000;

const running = (v: TokenClaimView | undefined) =>
	v?.status === "open" && v.items.some((i) => i.progress && !i.progress.done);

function IncidentCard({ item }: { item: ClaimViewDto }) {
	const { t } = useTranslation();
	const i = item.incident;
	const p = item.progress;
	return (
		<Card withBorder radius="md" padding="md">
			<Stack gap={6}>
				<Text fw={600} style={{ wordBreak: "break-all" }}>
					{i.url}
				</Text>
				<Text size="sm" c="dimmed">
					{t(`status.${i.type}`)}
					{i.httpCode ? ` · HTTP ${i.httpCode}` : ""}
					{i.errorType ? ` · ${t(`errorType.${i.errorType}`)}` : ""}
				</Text>
				<Text size="sm" c="dimmed">
					{t("confirm.detected", { at: formatDateTime(i.openedAt) })}
				</Text>
				{i.state === "closed" && (
					<Text size="sm" c={COLOR.success} fw={500}>
						{t("confirm.recoveredAt", { at: formatDateTime(i.closedAt) })}
						{i.closedBy ? ` — ${t("confirm.fixedBy", { by: i.closedBy })}` : ""}
					</Text>
				)}
				{p && (
					<Stack gap={2} mt={4} aria-live="polite">
						<Text size="sm" fw={500}>
							{t(`confirm.outcome.${p.outcome}`)}
						</Text>
						{Array.from({ length: p.total }, (_, i) => i + 1).map((attempt) => {
							const a = p.attempts.find((x) => x.attempt === attempt);
							const ok = a && (a.result === "up" || a.result === "slow");
							return (
								<Text
									key={attempt}
									size="sm"
									c={a ? (ok ? COLOR.success : COLOR.danger) : "dimmed"}
								>
									{t("confirm.attempt", { n: attempt })}:{" "}
									{a
										? `${t(`status.${a.result}`)}${a.httpCode ? ` (HTTP ${a.httpCode})` : ""}`
										: t(p.done ? "confirm.notNeeded" : "confirm.waiting")}
								</Text>
							);
						})}
					</Stack>
				)}
			</Stack>
		</Card>
	);
}

function Confirm({ token }: { token: string }) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [note, setNote] = useState("");
	const key = ["public-claim", token];
	const query = useQuery({
		queryKey: key,
		queryFn: () => api.getPublicClaim(token),
		refetchInterval: (q) => (running(q.state.data) ? CONFIRM_POLL_MS : false),
		refetchOnWindowFocus: false,
	});
	const submit = useMutation({
		mutationFn: () =>
			api.submitPublicClaim({
				token,
				...(note.trim() && { note: note.trim() }),
			}),
		onSuccess: (v) => queryClient.setQueryData(key, v),
	});

	if (query.isPending)
		return (
			<Center py="xl">
				<Loader />
			</Center>
		);
	if (query.isError)
		return (
			<Alert color={PALETTE.danger} variant="light">
				{t("confirm.loadError")}
			</Alert>
		);
	const v = query.data;
	if (v.status === "expired")
		return (
			<Alert color="yellow" variant="light" title={t("confirm.expiredTitle")}>
				{t("confirm.expired")}
			</Alert>
		);
	const started = v.items.some((i) => i.progress);
	// FR-38: once the checks of a claim are done and still failing, it can be reported again.
	const canSubmit =
		v.status === "open" && !v.items.some((i) => i.progress && !i.progress.done);
	return (
		<Stack gap="md">
			{/* FR-42: closed without a successful claim; a claim that fixed it shows its own outcome. */}
			{v.status === "recovered" &&
				!v.items.some((i) => i.progress?.outcome === "fixed") && (
					<Alert
						color={PALETTE.success}
						variant="light"
						title={t("confirm.recoveredTitle")}
					>
						{t("confirm.recovered")}
					</Alert>
				)}
			{v.items.map((item) => (
				<IncidentCard key={item.incident.id} item={item} />
			))}
			{canSubmit && (
				<>
					<Text size="sm">
						{t(started ? "confirm.again" : "confirm.intro")}
					</Text>
					<Textarea
						label={t("confirm.note")}
						placeholder={t("confirm.notePlaceholder")}
						rows={2}
						maxLength={1000}
						value={note}
						onChange={(e) => setNote(e.currentTarget.value)}
					/>
					<Button
						size="md"
						fullWidth
						loading={submit.isPending}
						onClick={() => submit.mutate()}
					>
						{t("confirm.button")}
					</Button>
					<Text size="xs" c="dimmed">
						{t("confirm.hint")}
					</Text>
				</>
			)}
			{submit.isError && (
				<Text size="sm" c={COLOR.danger} role="alert">
					{t("confirm.submitError")}
				</Text>
			)}
		</Stack>
	);
}

function Content() {
	const { t } = useTranslation();
	const token = useSearchParams().get("token");
	if (!token)
		return (
			<Alert color="yellow" variant="light" title={t("confirm.expiredTitle")}>
				{t("confirm.expired")}
			</Alert>
		);
	return <Confirm token={token} />;
}

/** SCR-10: "Fixed — check again" confirmation page (no sign-in, mobile first). */
export function ConfirmPage() {
	const { t } = useTranslation();
	return (
		<Center px="md" py="xl">
			<Stack gap="lg" w="100%" maw={480}>
				<Group gap="xs">
					<Logo label={t("app.title")} />
				</Group>
				<Title order={1} fz="xl">
					{t("confirm.title")}
				</Title>
				<Suspense fallback={<Loader />}>
					<Content />
				</Suspense>
			</Stack>
		</Center>
	);
}
