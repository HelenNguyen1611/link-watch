"use client";

import { LinkInput, type LinkUpdateRaw, type LinkView } from "@linkwatch/core";
import {
	Button,
	Group,
	Modal,
	NumberInput,
	SegmentedControl,
	Select,
	Stack,
	TagsInput,
	Text,
	TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { describeRule } from "@/features/schedules/describe";
import { ApiError } from "@/lib/api";
import { useApi } from "@/lib/api-context";
import { COLOR, PALETTE } from "@/lib/colors";
import { formatCodes, parseCodes } from "./codes";

type FormValues = {
	url: string;
	name: string;
	tags: string[];
	method: "GET" | "HEAD";
	codes: string;
	timeoutS: number | string;
	keyword: string;
	/** "" = inherit from the domain / default (FR-13). */
	scheduleId: string;
};

const toForm = (l: LinkView): FormValues => ({
	url: l.url,
	name: l.name ?? "",
	tags: l.tags,
	method: l.method,
	codes: formatCodes(l.expectedCodes),
	timeoutS: l.timeoutS,
	keyword: l.keyword ?? "",
	scheduleId: l.scheduleId ?? "",
});

/** Only the fields that changed; "" clears name / keyword. */
function diff(
	link: LinkView,
	v: FormValues,
	codes: LinkView["expectedCodes"],
): LinkUpdateRaw {
	const out: LinkUpdateRaw = {};
	if (v.url.trim() !== link.url) out.url = v.url;
	if (v.name.trim() !== (link.name ?? "")) out.name = v.name;
	if (JSON.stringify(v.tags) !== JSON.stringify(link.tags)) out.tags = v.tags;
	if (v.method !== link.method) out.method = v.method;
	if (JSON.stringify(codes) !== JSON.stringify(link.expectedCodes))
		out.expectedCodes = codes;
	if (Number(v.timeoutS) !== link.timeoutS) out.timeoutS = Number(v.timeoutS);
	if (v.keyword.trim() !== (link.keyword ?? "")) out.keyword = v.keyword;
	if (v.scheduleId !== (link.scheduleId ?? ""))
		out.scheduleId = v.scheduleId || null;
	return out;
}

/** Schema field → form field. */
const FIELD_OF: Record<string, keyof FormValues> = { expectedCodes: "codes" };

type Props = {
	link: LinkView | null;
	onClose: () => void;
	onSaved: (row: LinkView) => void;
};

/** FR-01 / FR-04: edit every setting of a link. */
export function EditLinkDialog({ link, onClose, onSaved }: Props) {
	const { t } = useTranslation();
	return (
		<Modal
			opened={link !== null}
			onClose={onClose}
			title={t("editLink.title")}
			size="lg"
		>
			{/* Keyed by link: the form starts from that link's values. */}
			{link && (
				<EditLinkForm
					key={link.id}
					link={link}
					onClose={onClose}
					onSaved={onSaved}
				/>
			)}
		</Modal>
	);
}

function EditLinkForm({
	link,
	onClose,
	onSaved,
}: Omit<Props, "link"> & { link: LinkView }) {
	const { t } = useTranslation();
	const api = useApi();
	const form = useForm<FormValues>({ defaultValues: toForm(link) });
	const schedules = useQuery({
		queryKey: ["schedules"],
		queryFn: () => api.listSchedules(),
	});
	const scheduleOptions = [
		{ value: "", label: t("editLink.inheritSchedule") },
		...(schedules.data?.items ?? [])
			.filter((s) => s.id !== "default")
			.map((s) => ({
				value: s.id,
				label: `${s.name} — ${describeRule(s.rule, t)}`,
			})),
	];

	const save = useMutation({
		mutationFn: (input: LinkUpdateRaw) => api.updateLink(link.id, input),
		onSuccess: (row) => {
			onSaved(row);
			notifications.show({
				color: PALETTE.success,
				message: t("editLink.saved"),
			});
			onClose();
		},
		onError: (err) => {
			if (err instanceof ApiError && err.status === 409)
				form.setError("url", { message: t("linkForm.errors.duplicate") });
			else if (err instanceof ApiError && err.status === 401) return;
			else form.setError("root", { message: t("linkForm.errors.unknown") });
		},
	});

	const submit = form.handleSubmit((v) => {
		const codes = parseCodes(v.codes);
		if (!codes) {
			form.setError("codes", { message: t("editLink.errors.codes") });
			return;
		}
		// Same rules as the API (shared schema).
		const parsed = LinkInput.safeParse({
			url: v.url,
			name: v.name,
			tags: v.tags,
			method: v.method,
			expectedCodes: codes,
			timeoutS: Number(v.timeoutS),
			keyword: v.keyword,
		});
		if (!parsed.success) {
			for (const issue of parsed.error.issues) {
				const key = String(issue.path[0]);
				const field = FIELD_OF[key] ?? (key as keyof FormValues);
				const code = (issue as { params?: { code?: string } }).params?.code;
				form.setError(field, {
					message: code
						? t(`linkForm.errors.${code}`)
						: t(`editLink.errors.${field}`, { defaultValue: issue.message }),
				});
			}
			return;
		}
		const changes = diff(link, v, parsed.data.expectedCodes);
		if (Object.keys(changes).length === 0) return onClose();
		save.mutate(changes);
	});

	const err = (k: keyof FormValues) => form.formState.errors[k]?.message;
	return (
		<form onSubmit={submit} noValidate>
			<Stack gap="md">
				<TextInput
					label={t("linkForm.url")}
					required
					error={err("url")}
					{...form.register("url")}
				/>
				{(form.watch("url") ?? "").trim() !== link.url && (
					<Text size="xs" c="dimmed">
						{t("editLink.urlChangeHint")}
					</Text>
				)}
				<TextInput
					label={t("linkForm.name")}
					error={err("name")}
					{...form.register("name")}
				/>
				<Controller
					control={form.control}
					name="tags"
					render={({ field }) => (
						<TagsInput
							label={t("editLink.tags")}
							description={t("editLink.tagsHint")}
							value={field.value}
							onChange={field.onChange}
							maxTags={20}
							clearable
						/>
					)}
				/>
				<Group grow align="flex-start">
					<Controller
						control={form.control}
						name="method"
						render={({ field }) => (
							<Stack gap={4}>
								<Text size="sm" fw={500}>
									{t("editLink.method")}
								</Text>
								<SegmentedControl
									data={["GET", "HEAD"]}
									value={field.value}
									onChange={(v) => field.onChange(v as "GET" | "HEAD")}
								/>
							</Stack>
						)}
					/>
					<Controller
						control={form.control}
						name="timeoutS"
						render={({ field }) => (
							<NumberInput
								label={t("editLink.timeout")}
								suffix=" s"
								min={1}
								max={60}
								allowDecimal={false}
								value={field.value}
								onChange={field.onChange}
								error={err("timeoutS")}
							/>
						)}
					/>
				</Group>
				<TextInput
					label={t("editLink.codes")}
					description={t("editLink.codesHint")}
					error={err("codes")}
					{...form.register("codes")}
				/>
				<Controller
					control={form.control}
					name="scheduleId"
					render={({ field }) => (
						<Select
							label={t("editLink.schedule")}
							description={t("editLink.scheduleHint")}
							data={scheduleOptions}
							value={field.value}
							onChange={(v) => field.onChange(v ?? "")}
							allowDeselect={false}
						/>
					)}
				/>
				<TextInput
					label={t("editLink.keyword")}
					description={t("editLink.keywordHint")}
					error={err("keyword")}
					{...form.register("keyword")}
				/>
				{form.formState.errors.root && (
					<Text size="sm" c={COLOR.danger} role="alert">
						{form.formState.errors.root.message}
					</Text>
				)}
				<Group justify="flex-end" gap="xs">
					<Button variant="subtle" color="gray" onClick={onClose}>
						{t("linkForm.cancel")}
					</Button>
					<Button type="submit" variant="light" loading={save.isPending}>
						{t("editLink.save")}
					</Button>
				</Group>
			</Stack>
		</form>
	);
}
