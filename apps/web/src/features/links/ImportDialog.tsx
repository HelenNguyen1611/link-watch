"use client";

import { MAX_IMPORT_ROWS } from "@linkwatch/core";
import {
	Alert,
	Badge,
	Button,
	FileButton,
	Group,
	Modal,
	Progress,
	Stack,
	Table,
	Text,
	Textarea,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
	ApiError,
	type ImportCommitView,
	type ImportPreviewView,
	type ImportRowView,
} from "@/lib/api";
import { useApi } from "@/lib/api-context";
import { PALETTE } from "@/lib/colors";
import { importChunks } from "./import-chunks";
import { useLinksData } from "./links-data";

/** Preview rows shown at most (the summary always counts every row). */
const PREVIEW_ROWS = 200;

const statusColor = (s: ImportRowView["status"]) =>
	s === "valid"
		? PALETTE.success
		: s === "duplicate"
			? "yellow"
			: PALETTE.danger;

/** FR-03 / FR-07 / AC-01: import links from pasted text or a CSV file (≤ 1,000 rows). */
export function ImportDialog({
	opened,
	onClose,
}: {
	opened: boolean;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const api = useApi();
	const data = useLinksData();
	const [text, setText] = useState("");
	const [preview, setPreview] = useState<ImportPreviewView | null>(null);
	const [busy, setBusy] = useState<"preview" | "import" | null>(null);
	const [progress, setProgress] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [result, setResult] = useState<ImportCommitView | null>(null);

	const reset = () => {
		setText("");
		setPreview(null);
		setResult(null);
		setError(null);
		setProgress(0);
	};
	const close = () => {
		if (busy === "import") return;
		reset();
		onClose();
	};

	const runPreview = async () => {
		setBusy("preview");
		setError(null);
		setResult(null);
		try {
			setPreview(await api.previewImport(text));
		} catch (err) {
			setError(
				err instanceof ApiError && err.body.error === "import_too_large"
					? t("importLinks.errors.tooLarge", { max: MAX_IMPORT_ROWS })
					: t("importLinks.errors.failed"),
			);
		} finally {
			setBusy(null);
		}
	};

	const runImport = async () => {
		const chunks = importChunks(text);
		setBusy("import");
		setProgress(0);
		const total: ImportCommitView = { created: [], rejected: [] };
		try {
			for (const [i, chunk] of chunks.entries()) {
				const res = await api.commitImport(chunk);
				total.created.push(...res.created);
				total.rejected.push(...res.rejected);
				setProgress(Math.round(((i + 1) / chunks.length) * 100));
			}
		} catch {
			setError(
				t("importLinks.errors.partial", { count: total.created.length }),
			);
		}
		setResult(total);
		setBusy(null);
		// Show the new links at once (the snapshot only catches up on the next tick).
		for (let i = 0; i < total.created.length; i += 100) {
			const keys = total.created
				.slice(i, i + 100)
				.map((c) => ({ domain: c.domain, id: c.id }));
			const fresh = await api.freshLinks(keys).catch(() => ({ items: [] }));
			for (const row of fresh.items) data?.upsert(row);
		}
		if (total.created.length > 0)
			notifications.show({
				color: PALETTE.success,
				message: t("importLinks.done", { count: total.created.length }),
			});
	};

	const onFile = async (file: File | null) => {
		if (!file) return;
		setText(await file.text());
		setPreview(null);
		setResult(null);
	};

	const reason = (r: ImportRowView) =>
		r.error
			? t(`importLinks.reasons.${r.error}`, { field: r.field ?? "" })
			: t("importLinks.reasons.ok");

	return (
		<Modal
			opened={opened}
			onClose={close}
			title={t("importLinks.title")}
			size="xl"
		>
			<Stack gap="md">
				<Text size="sm" c="dimmed">
					{t("importLinks.help", { max: MAX_IMPORT_ROWS })}
				</Text>
				<Textarea
					label={t("importLinks.textLabel")}
					placeholder={"https://example.com/\nhttps://shop.example.com/pricing"}
					rows={8}
					value={text}
					onChange={(e) => {
						setText(e.currentTarget.value);
						setPreview(null);
						setResult(null);
					}}
					disabled={busy !== null}
					styles={{
						input: {
							fontFamily: "var(--mantine-font-family-monospace)",
							fontSize: 13,
						},
					}}
				/>
				<Group gap="xs">
					<FileButton onChange={onFile} accept=".csv,.txt,text/csv,text/plain">
						{(props) => (
							<Button
								variant="subtle"
								size="xs"
								disabled={busy !== null}
								{...props}
							>
								{t("importLinks.chooseFile")}
							</Button>
						)}
					</FileButton>
					<Button
						variant="light"
						onClick={runPreview}
						loading={busy === "preview"}
						disabled={!text.trim() || busy === "import"}
					>
						{t("importLinks.preview")}
					</Button>
				</Group>

				{error && (
					<Alert color={PALETTE.danger} variant="light" role="alert">
						{error}
					</Alert>
				)}

				{preview && !result && (
					<Stack gap="sm">
						<Group gap="xs" aria-label={t("importLinks.summaryLabel")}>
							<Badge color={PALETTE.success} variant="light">
								{t("importLinks.summary.valid", {
									count: preview.summary.valid,
								})}
							</Badge>
							<Badge color="yellow" variant="light">
								{t("importLinks.summary.duplicate", {
									count: preview.summary.duplicate,
								})}
							</Badge>
							<Badge color={PALETTE.danger} variant="light">
								{t("importLinks.summary.error", {
									count: preview.summary.error,
								})}
							</Badge>
						</Group>
						<Table.ScrollContainer minWidth={560} mah={280}>
							<Table
								verticalSpacing={4}
								fz="sm"
								aria-label={t("importLinks.previewTable")}
							>
								<Table.Thead>
									<Table.Tr>
										<Table.Th w={60}>{t("importLinks.col.line")}</Table.Th>
										<Table.Th>{t("importLinks.col.url")}</Table.Th>
										<Table.Th>{t("importLinks.col.result")}</Table.Th>
									</Table.Tr>
								</Table.Thead>
								<Table.Tbody>
									{preview.rows.slice(0, PREVIEW_ROWS).map((r) => (
										<Table.Tr key={r.line}>
											<Table.Td>{r.line}</Table.Td>
											<Table.Td style={{ wordBreak: "break-all" }}>
												{r.url || "—"}
											</Table.Td>
											<Table.Td>
												<Text size="sm" c={statusColor(r.status)}>
													{reason(r)}
												</Text>
											</Table.Td>
										</Table.Tr>
									))}
								</Table.Tbody>
							</Table>
						</Table.ScrollContainer>
						{preview.rows.length > PREVIEW_ROWS && (
							<Text size="xs" c="dimmed">
								{t("importLinks.moreRows", {
									count: preview.rows.length - PREVIEW_ROWS,
								})}
							</Text>
						)}
					</Stack>
				)}

				{busy === "import" && (
					<Progress
						value={progress}
						animated
						aria-label={t("importLinks.progress")}
					/>
				)}

				{result && (
					<Alert
						color={result.created.length > 0 ? PALETTE.success : "yellow"}
						variant="light"
						role="status"
					>
						<Text size="sm">
							{t("importLinks.result", {
								created: result.created.length,
								rejected: result.rejected.length,
							})}
						</Text>
					</Alert>
				)}

				<Group justify="flex-end" gap="xs">
					<Button
						variant="subtle"
						color="gray"
						onClick={close}
						disabled={busy === "import"}
					>
						{result ? t("importLinks.close") : t("linkForm.cancel")}
					</Button>
					{!result && (
						<Button
							variant="light"
							onClick={runImport}
							loading={busy === "import"}
							disabled={!preview || preview.summary.valid === 0}
						>
							{t("importLinks.import", { count: preview?.summary.valid ?? 0 })}
						</Button>
					)}
				</Group>
			</Stack>
		</Modal>
	);
}
