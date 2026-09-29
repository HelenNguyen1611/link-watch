"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
	Alert,
	Anchor,
	Box,
	Button,
	Center,
	List,
	PasswordInput,
	Stack,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { type UseFormReturn, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { IconCircleCheck } from "@/components/icons";
import { Logo } from "@/components/Logo";
import underline from "@/components/underline.module.css";
import {
	type AuthErrorCode,
	authErrorCode,
	newPasswordSchema,
	PASSWORD_RULE_CODES,
	refineNewPassword,
	safeNext,
	unmetPasswordRules,
} from "@/lib/auth";
import { useAuth } from "@/lib/auth-context";
import { COLOR, PALETTE } from "@/lib/colors";

type Step = "signIn" | "newPassword" | "forgotRequest" | "forgotConfirm";
type Notice = "passwordChanged" | "codeSent";

/** Field errors are translation keys under `auth.fieldErrors`. */
const email = z
	.string()
	.trim()
	.min(1, "emailRequired")
	.pipe(z.email({ message: "emailInvalid" }));
const signInSchema = z.object({
	email,
	password: z.string().min(1, "passwordRequired"),
});
const forgotRequestSchema = z.object({ email });
const forgotConfirmSchema = z
	.object({
		code: z.string().trim().min(1, "codeRequired"),
		password: z.string(),
		confirm: z.string(),
	})
	.superRefine(refineNewPassword);

/** Translates a field error (`auth.fieldErrors.<code>`). */
function useFieldError() {
	const { t } = useTranslation();
	return (message?: string) =>
		message ? t(`auth.fieldErrors.${message}`) : undefined;
}

function ErrorAlert({ code }: { code: AuthErrorCode | null }) {
	const { t } = useTranslation();
	if (!code) return null;
	return (
		<Alert color={PALETTE.danger} variant="light" role="alert">
			{t(`auth.errors.${code}`)}
		</Alert>
	);
}

function SubmitButton({
	loading,
	children,
}: {
	loading: boolean;
	children: ReactNode;
}) {
	return (
		<Button type="submit" variant="light" h={44} fullWidth loading={loading}>
			{children}
		</Button>
	);
}

/** Live checklist of the User Pool password rules. */
function PasswordRules({ password }: { password: string }) {
	const { t } = useTranslation();
	const unmet = new Set(unmetPasswordRules(password));
	return (
		<List spacing={4} size="sm" listStyleType="none" data-password-rules>
			{PASSWORD_RULE_CODES.map((code) => {
				const met = !unmet.has(code);
				return (
					<List.Item
						key={code}
						data-met={met}
						icon={
							<Box
								component="span"
								c={met ? COLOR.success : "dimmed"}
								style={{ display: "flex" }}
							>
								<IconCircleCheck size={16} />
							</Box>
						}
						c={met ? undefined : "dimmed"}
					>
						{t(`auth.rules.${code}`)}
					</List.Item>
				);
			})}
		</List>
	);
}

type PasswordFields = { password: string; confirm: string };

/** New password + rules checklist + confirmation, shared by the first sign-in and the reset. */
function NewPasswordFields<T extends PasswordFields>({
	form,
}: {
	form: UseFormReturn<T>;
}) {
	const { t } = useTranslation();
	const fieldError = useFieldError();
	// Narrow to the two shared fields (both forms contain them).
	const f = form as unknown as UseFormReturn<PasswordFields>;
	const password = f.watch("password") ?? "";
	return (
		<>
			<PasswordInput
				label={t("auth.newPassword.password")}
				autoComplete="new-password"
				classNames={underline}
				error={fieldError(f.formState.errors.password?.message)}
				{...f.register("password")}
			/>
			<PasswordRules password={password} />
			<PasswordInput
				label={t("auth.newPassword.confirm")}
				autoComplete="new-password"
				classNames={underline}
				error={fieldError(f.formState.errors.confirm?.message)}
				{...f.register("confirm")}
			/>
		</>
	);
}

/**
 * FR-28 sign-in page (outside the app shell): email + password, first-time new password,
 * and forgot password (code by email). After signing in it returns to `?next=` (same site only).
 */
export function LoginPage() {
	const { t } = useTranslation();
	const { status, client, refresh } = useAuth();
	const router = useRouter();
	const fieldError = useFieldError();
	const [step, setStep] = useState<Step>("signIn");
	const [notice, setNotice] = useState<Notice | null>(null);
	const [error, setError] = useState<AuthErrorCode | null>(null);
	const [busy, setBusy] = useState(false);
	const [address, setAddress] = useState("");
	const [next, setNext] = useState("/");

	useEffect(() => {
		setNext(safeNext(new URLSearchParams(window.location.search).get("next")));
	}, []);
	useEffect(() => {
		if (status === "signedIn") router.replace(next);
	}, [status, next, router]);

	const signInForm = useForm<z.input<typeof signInSchema>>({
		resolver: zodResolver(signInSchema),
		defaultValues: { email: "", password: "" },
	});
	const newPasswordForm = useForm<{ password: string; confirm: string }>({
		resolver: zodResolver(newPasswordSchema),
		defaultValues: { password: "", confirm: "" },
	});
	const forgotRequestForm = useForm<z.input<typeof forgotRequestSchema>>({
		resolver: zodResolver(forgotRequestSchema),
		defaultValues: { email: "" },
	});
	const forgotConfirmForm = useForm<{
		code: string;
		password: string;
		confirm: string;
	}>({
		resolver: zodResolver(forgotConfirmSchema),
		defaultValues: { code: "", password: "", confirm: "" },
	});

	const go = (to: Step, n: Notice | null = null) => {
		setError(null);
		setNotice(n);
		setStep(to);
	};

	/** Runs an auth call with the busy flag and a translated error. */
	const attempt = async (fn: () => Promise<void>) => {
		if (!client) return;
		setBusy(true);
		setError(null);
		try {
			await fn();
		} catch (err) {
			setError(authErrorCode(err));
		} finally {
			setBusy(false);
		}
	};

	const finishSignIn = async () => {
		await refresh();
		router.replace(next);
	};

	let title: string;
	let description: ReactNode;
	let body: ReactNode;

	if (status === "unconfigured") {
		title = t("auth.signIn.title");
		description = null;
		body = (
			<Alert color={PALETTE.danger} variant="light">
				{t("auth.unconfigured")}
			</Alert>
		);
	} else if (step === "signIn") {
		title = t("auth.signIn.title");
		description = t("auth.signIn.description");
		body = (
			<form
				noValidate
				onSubmit={signInForm.handleSubmit((v) =>
					attempt(async () => {
						if (!client) return;
						const res = await client.signIn(v.email, v.password);
						setAddress(v.email.trim());
						if (res.kind === "signedIn") await finishSignIn();
						else if (res.kind === "newPasswordRequired") go("newPassword");
						else go("forgotConfirm", "codeSent");
					}),
				)}
			>
				<Stack gap="md">
					<TextInput
						label={t("auth.signIn.email")}
						type="email"
						autoComplete="username"
						classNames={underline}
						error={fieldError(signInForm.formState.errors.email?.message)}
						{...signInForm.register("email")}
					/>
					<PasswordInput
						label={t("auth.signIn.password")}
						autoComplete="current-password"
						classNames={underline}
						error={fieldError(signInForm.formState.errors.password?.message)}
						{...signInForm.register("password")}
					/>
					<Anchor
						component="button"
						type="button"
						size="sm"
						ta="left"
						onClick={() => {
							forgotRequestForm.setValue(
								"email",
								signInForm.getValues("email"),
							);
							go("forgotRequest");
						}}
					>
						{t("auth.signIn.forgot")}
					</Anchor>
					<ErrorAlert code={error} />
					<SubmitButton loading={busy}>{t("auth.signIn.submit")}</SubmitButton>
				</Stack>
			</form>
		);
	} else if (step === "newPassword") {
		title = t("auth.newPassword.title");
		description = t("auth.newPassword.description");
		body = (
			<form
				noValidate
				onSubmit={newPasswordForm.handleSubmit((v) =>
					attempt(async () => {
						await client?.completeNewPassword(v.password);
						await finishSignIn();
					}),
				)}
			>
				<Stack gap="md">
					<NewPasswordFields form={newPasswordForm} />
					<ErrorAlert code={error} />
					<SubmitButton loading={busy}>
						{t("auth.newPassword.submit")}
					</SubmitButton>
				</Stack>
			</form>
		);
	} else if (step === "forgotRequest") {
		title = t("auth.forgot.title");
		description = t("auth.forgot.description");
		body = (
			<form
				noValidate
				onSubmit={forgotRequestForm.handleSubmit((v) =>
					attempt(async () => {
						await client?.requestPasswordReset(v.email);
						setAddress(v.email.trim());
						go("forgotConfirm", "codeSent");
					}),
				)}
			>
				<Stack gap="md">
					<TextInput
						label={t("auth.signIn.email")}
						type="email"
						autoComplete="username"
						classNames={underline}
						error={fieldError(
							forgotRequestForm.formState.errors.email?.message,
						)}
						{...forgotRequestForm.register("email")}
					/>
					<ErrorAlert code={error} />
					<SubmitButton loading={busy}>{t("auth.forgot.submit")}</SubmitButton>
				</Stack>
			</form>
		);
	} else {
		title = t("auth.forgot.confirmTitle");
		description = t("auth.forgot.confirmDescription", { email: address });
		body = (
			<form
				noValidate
				onSubmit={forgotConfirmForm.handleSubmit((v) =>
					attempt(async () => {
						await client?.confirmPasswordReset(address, v.code, v.password);
						forgotConfirmForm.reset();
						signInForm.reset({ email: address, password: "" });
						go("signIn", "passwordChanged");
					}),
				)}
			>
				<Stack gap="md">
					<TextInput
						label={t("auth.forgot.code")}
						inputMode="numeric"
						autoComplete="one-time-code"
						classNames={underline}
						error={fieldError(forgotConfirmForm.formState.errors.code?.message)}
						{...forgotConfirmForm.register("code")}
					/>
					<NewPasswordFields form={forgotConfirmForm} />
					<ErrorAlert code={error} />
					<SubmitButton loading={busy}>
						{t("auth.forgot.confirmSubmit")}
					</SubmitButton>
					<Anchor
						component="button"
						type="button"
						size="sm"
						disabled={busy}
						onClick={() =>
							attempt(async () => {
								await client?.requestPasswordReset(address);
								setNotice("codeSent");
							})
						}
					>
						{t("auth.forgot.resend")}
					</Anchor>
				</Stack>
			</form>
		);
	}

	return (
		<Center mih="100dvh" px="md" py="xl">
			<Stack w="100%" maw={380} gap="lg">
				<Logo label={t("app.title")} />
				<Stack gap={6}>
					<Title order={2}>{title}</Title>
					{description && (
						<Text c="dimmed" size="sm">
							{description}
						</Text>
					)}
				</Stack>
				{notice && (
					<Alert color={PALETTE.success} variant="light" role="status">
						{t(`auth.notice.${notice}`)}
					</Alert>
				)}
				{status === "loading" ? null : body}
				{step !== "signIn" && status !== "unconfigured" && (
					<Anchor
						component="button"
						type="button"
						size="sm"
						onClick={() => {
							newPasswordForm.reset();
							go("signIn");
						}}
					>
						← {t("auth.forgot.back")}
					</Anchor>
				)}
			</Stack>
		</Center>
	);
}
