"use client";

import {
	isSenderAllowed,
	SettingsInput,
	type SettingsView,
} from "@linkwatch/core";
import {
	Alert,
	Anchor,
	Box,
	Button,
	Divider,
	Fieldset,
	Group,
	Loader,
	NumberInput,
	Stack,
	Switch,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Controller, type Resolver, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { IconMail } from "@/components/icons";
import { PageHeader } from "@/components/PageHeader";
import underline from "@/components/underline.module.css";
import { ApiError } from "@/lib/api";
import { useApi } from "@/lib/api-context";
import { useAuth, useCan } from "@/lib/auth-context";
import { PALETTE } from "@/lib/colors";

type FormValues = {
	senderEmail: string;
	senderName: string;
	defaultAdminEmail: string;
	remindersEnabled: boolean;
	reminderIntervalHours: number | string;
};
type Field = keyof FormValues;

const SETTINGS_KEY = ["settings"] as const;

/** Error code (i18n key under settingsEmail.errors) for one invalid field. */
function errorCode(field: Field): string {
	if (field === "reminderIntervalHours") return "interval";
	if (field === "senderName") return "senderName";
	return "email";
}

/**
 * Form schema = the shared `SettingsInput` with every field required (the form always
 * sends all of them), plus FR-26: the sender belongs to the verified SES identity.
 */
function formSchema(sesIdentity: string) {
	return SettingsInput.required().superRefine((v, ctx) => {
		if (!isSenderAllowed(v.senderEmail, sesIdentity))
			ctx.addIssue({
				code: "custom",
				path: ["senderEmail"],
				message: "senderDomain",
			});
	});
}

const toForm = (s: SettingsView): FormValues => ({
	senderEmail: s.senderEmail,
	senderName: s.senderName,
	defaultAdminEmail: s.defaultAdminEmail ?? "",
	remindersEnabled: s.remindersEnabled,
	reminderIntervalHours: s.reminderIntervalHours,
});

function Section(props: {
	title: string;
	description: string;
	children: ReactNode;
}) {
	return (
		<Stack gap="sm">
			<Box>
				<Title order={3} fz="md" fw={600}>
					{props.title}
				</Title>
				<Text size="sm" c="dimmed">
					{props.description}
				</Text>
			</Box>
			{props.children}
		</Stack>
	);
}

/** SCR-08: sender, default admin email, reminders (FR-20, FR-23, FR-26). */
export function EmailSettingsPage() {
	const { t } = useTranslation();
	const api = useApi();
	const settings = useQuery({
		queryKey: SETTINGS_KEY,
		queryFn: () => api.getSettings(),
	});
	const unauthorized =
		settings.error instanceof ApiError && settings.error.status === 401;
	// HLR-09: email settings and the test email are admin-only; others see them read-only.
	const canConfigure = useCan()("configure");

	return (
		<>
			<PageHeader
				title={t("nav.settingsEmail")}
				description={t("settingsEmail.subtitle")}
				mb={24}
			/>
			{settings.isPending ? (
				<Loader />
			) : settings.isError ? (
				unauthorized ? null : (
					<Alert color={PALETTE.danger} variant="light">
						{t("settingsEmail.loadError")}
					</Alert>
				)
			) : (
				<Stack gap={40} maw={640} pb={40}>
					{!canConfigure && (
						<Alert color="gray" variant="light">
							{t("settingsEmail.readOnly")}
						</Alert>
					)}
					<SettingsForm settings={settings.data} readOnly={!canConfigure} />
					<Divider />
					<AlertUsers
						emails={settings.data.alertEmails}
						canEdit={canConfigure}
					/>
					{canConfigure && (
						<>
							<Divider />
							<TestEmail settings={settings.data} />
						</>
					)}
				</Stack>
			)}
		</>
	);
}

/**
 * FR-20: users who get every alert (switched on the Users screen). Removing one here also
 * covers an email left over from an account deleted outside LinkWatch.
 */
function AlertUsers({
	emails,
	canEdit,
}: {
	emails: string[];
	canEdit: boolean;
}) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const remove = useMutation({
		mutationFn: (email: string) => api.setUserAlerts(email, false),
		onSuccess: (res) => {
			void queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
			void queryClient.invalidateQueries({ queryKey: ["users"] });
			notifications.show({
				color: PALETTE.success,
				message: t("settingsEmail.alertUsers.removed", { email: res.email }),
			});
		},
		onError: () =>
			notifications.show({
				color: PALETTE.danger,
				message: t("settingsEmail.alertUsers.failed"),
			}),
	});
	return (
		<Section
			title={t("settingsEmail.alertUsers.title")}
			description={t("settingsEmail.alertUsers.description")}
		>
			{emails.length === 0 ? (
				<Text size="sm" c="dimmed">
					{t("settingsEmail.alertUsers.empty")}
				</Text>
			) : (
				<Stack gap={4} component="ul" p={0} m={0} style={{ listStyle: "none" }}>
					{emails.map((email) => (
						<Group key={email} component="li" justify="space-between">
							<Text size="sm">{email}</Text>
							{canEdit && (
								<Button
									size="xs"
									variant="subtle"
									color="gray"
									loading={remove.isPending && remove.variables === email}
									onClick={() => remove.mutate(email)}
									aria-label={`${t("settingsEmail.alertUsers.remove")} ${email}`}
								>
									{t("settingsEmail.alertUsers.remove")}
								</Button>
							)}
						</Group>
					))}
				</Stack>
			)}
			{canEdit && (
				<Anchor component={Link} href="/settings/users/" size="sm">
					{t("settingsEmail.alertUsers.manage")} →
				</Anchor>
			)}
		</Section>
	);
}

function SettingsForm({
	settings,
	readOnly,
}: {
	settings: SettingsView;
	readOnly: boolean;
}) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const schema = useMemo(
		() => formSchema(settings.sesIdentity),
		[settings.sesIdentity],
	);

	const resolver: Resolver<FormValues, unknown, SettingsInput> = async (
		values,
	) => {
		const parsed = schema.safeParse({
			...values,
			reminderIntervalHours:
				values.reminderIntervalHours === ""
					? Number.NaN
					: Number(values.reminderIntervalHours),
		});
		if (parsed.success) return { values: parsed.data, errors: {} };
		const errors: Record<string, { type: string; message: string }> = {};
		for (const issue of parsed.error.issues) {
			const field = String(issue.path[0]) as Field;
			if (errors[field]) continue;
			const code =
				issue.message === "senderDomain" ? "senderDomain" : errorCode(field);
			errors[field] = { type: "validate", message: code };
		}
		return { values: {}, errors };
	};

	const form = useForm<FormValues, unknown, SettingsInput>({
		defaultValues: toForm(settings),
		resolver,
	});
	// After a save (or another tab's change), the loaded values become the new baseline.
	useEffect(() => {
		form.reset(toForm(settings));
	}, [settings, form]);

	const save = useMutation({
		mutationFn: (input: SettingsInput) => api.updateSettings(input),
		onSuccess: (saved) => {
			queryClient.setQueryData(SETTINGS_KEY, saved);
			notifications.show({
				color: PALETTE.success,
				message: t("settingsEmail.saved"),
			});
		},
		onError: (err) => {
			if (err instanceof ApiError && err.status === 401) return;
			if (err instanceof ApiError && err.body.error === "sender_not_verified")
				form.setError("senderEmail", { message: "senderDomain" });
			else if (err instanceof ApiError && err.status === 400)
				form.setError("root", { message: "validation" });
			else form.setError("root", { message: "unknown" });
		},
	});

	const errorText = (field: Field) => {
		const code = form.formState.errors[field]?.message;
		return code
			? t(`settingsEmail.errors.${code}`, { identity: settings.sesIdentity })
			: undefined;
	};
	const remindersOn = form.watch("remindersEnabled");

	return (
		<form
			onSubmit={form.handleSubmit((input) => save.mutate(input))}
			noValidate
			aria-label={t("settingsEmail.formLabel")}
		>
			<Fieldset variant="unstyled" disabled={readOnly}>
				<Stack gap={32}>
					<Section
						title={t("settingsEmail.sender.title")}
						description={t("settingsEmail.sender.description", {
							identity: settings.sesIdentity,
						})}
					>
						<TextInput
							label={t("settingsEmail.sender.email")}
							placeholder={`noreply@${settings.sesIdentity}`}
							required
							classNames={underline}
							error={errorText("senderEmail")}
							{...form.register("senderEmail")}
						/>
						<TextInput
							label={t("settingsEmail.sender.name")}
							placeholder="LinkWatch"
							required
							classNames={underline}
							error={errorText("senderName")}
							{...form.register("senderName")}
						/>
					</Section>

					<Section
						title={t("settingsEmail.admin.title")}
						description={t("settingsEmail.admin.description")}
					>
						<TextInput
							label={t("settingsEmail.admin.email")}
							placeholder="admin@example.com"
							required
							classNames={underline}
							error={errorText("defaultAdminEmail")}
							{...form.register("defaultAdminEmail")}
						/>
					</Section>

					<Section
						title={t("settingsEmail.reminders.title")}
						description={t("settingsEmail.reminders.description")}
					>
						<Controller
							control={form.control}
							name="remindersEnabled"
							render={({ field }) => (
								<Switch
									label={t("settingsEmail.reminders.enabled")}
									checked={field.value}
									onChange={(e) => field.onChange(e.currentTarget.checked)}
								/>
							)}
						/>
						<Controller
							control={form.control}
							name="reminderIntervalHours"
							render={({ field }) => (
								<NumberInput
									label={t("settingsEmail.reminders.interval")}
									suffix={` ${t("settingsEmail.reminders.hours")}`}
									min={1}
									max={720}
									allowDecimal={false}
									disabled={!remindersOn}
									classNames={underline}
									maw={240}
									value={field.value}
									onChange={field.onChange}
									onBlur={field.onBlur}
									error={errorText("reminderIntervalHours")}
								/>
							)}
						/>
					</Section>

					{form.formState.errors.root && (
						<Text size="sm" c={PALETTE.danger} role="alert">
							{t(`settingsEmail.errors.${form.formState.errors.root.message}`)}
						</Text>
					)}
					{!readOnly && (
						<Group gap="xs">
							<Button
								type="submit"
								variant="light"
								loading={save.isPending}
								disabled={!form.formState.isDirty}
							>
								{t("settingsEmail.save")}
							</Button>
							{form.formState.isDirty && (
								<Button
									variant="subtle"
									color="gray"
									onClick={() => form.reset(toForm(settings))}
								>
									{t("settingsEmail.discard")}
								</Button>
							)}
						</Group>
					)}
				</Stack>
			</Fieldset>
		</form>
	);
}

const TestEmailInput = z.object({
	to: z.union([z.literal(""), z.string().trim().pipe(z.email())]),
});

function TestEmail({ settings }: { settings: SettingsView }) {
	const { t } = useTranslation();
	const api = useApi();
	const auth = useAuth();
	const me = auth.user?.email;
	const [to, setTo] = useState("");
	const [invalid, setInvalid] = useState(false);

	const send = useMutation({
		mutationFn: (recipient?: string) => api.sendTestEmail(recipient),
	});
	const failure =
		send.error instanceof ApiError
			? String(send.error.body.error ?? send.error.status)
			: send.error
				? String(send.error)
				: undefined;

	return (
		<Section
			title={t("settingsEmail.test.title")}
			description={t("settingsEmail.test.description", {
				sender: settings.senderEmail,
			})}
		>
			<Group align="flex-end" gap="sm" wrap="wrap">
				<TextInput
					label={t("settingsEmail.test.to")}
					placeholder={me ?? "you@example.com"}
					classNames={underline}
					style={{ flex: "1 1 260px" }}
					value={to}
					error={invalid ? t("settingsEmail.errors.email") : undefined}
					onChange={(e) => {
						setTo(e.currentTarget.value);
						setInvalid(false);
					}}
				/>
				<Button
					variant="light"
					leftSection={<IconMail size={16} />}
					loading={send.isPending}
					onClick={() => {
						const parsed = TestEmailInput.safeParse({ to });
						if (!parsed.success) return setInvalid(true);
						send.mutate(parsed.data.to || undefined);
					}}
				>
					{t("settingsEmail.test.send")}
				</Button>
			</Group>
			{send.isSuccess && (
				<Alert color={PALETTE.success} variant="light" role="status">
					{t("settingsEmail.test.sent", { to: send.data.to })}
				</Alert>
			)}
			{failure &&
				!(send.error instanceof ApiError && send.error.status === 401) && (
					<Alert color={PALETTE.danger} variant="light" role="alert">
						<Text size="sm" fw={500}>
							{t("settingsEmail.test.failed")}
						</Text>
						<Text size="sm">{failure}</Text>
						<Text size="xs" c="dimmed" mt={4}>
							{t("settingsEmail.test.sandboxHint")}
						</Text>
					</Alert>
				)}
		</Section>
	);
}
