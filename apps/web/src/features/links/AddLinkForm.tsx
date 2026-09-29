"use client";

import { LinkInput, type LinkInputRaw } from "@linkwatch/core";
import { Button, Group, TextInput } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FieldErrors, type Resolver, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { IconArrowRight } from "@/components/icons";
import underline from "@/components/underline.module.css";
import { ApiError } from "@/lib/api";
import { useApi } from "@/lib/api-context";

type FormValues = { url: string; name: string };
type Issue = {
	path: PropertyKey[];
	message: string;
	params?: { code?: string };
};

/** Maps Zod issues (from the form or an API 400) to field errors, translated by URL error code. */
function fieldErrors(issues: Issue[], t: (k: string) => string) {
	const errors: Record<string, { type: string; message: string }> = {};
	for (const issue of issues) {
		const field = String(issue.path[0] ?? "url");
		if (errors[field]) continue;
		const code = issue.params?.code;
		errors[field] = {
			type: "validate",
			message: code ? t(`linkForm.errors.${code}`) : issue.message,
		};
	}
	return errors;
}

/** FR-01, FR-02: shares the `LinkInput` Zod schema with the backend. */
export function AddLinkForm() {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();

	const resolver: Resolver<FormValues, unknown, LinkInputRaw> = async (
		values,
	) => {
		const parsed = LinkInput.safeParse({ url: values.url, name: values.name });
		if (parsed.success)
			return {
				values: { url: parsed.data.url, name: parsed.data.name },
				errors: {},
			};
		return {
			values: {} as Record<string, never>,
			errors: fieldErrors(
				parsed.error.issues as Issue[],
				t,
			) as FieldErrors<FormValues>,
		};
	};
	const form = useForm<FormValues, unknown, LinkInputRaw>({
		defaultValues: { url: "", name: "" },
		resolver,
	});

	const create = useMutation({
		mutationFn: (input: LinkInputRaw) => api.createLink(input),
		onSuccess: () => {
			form.reset();
			return queryClient.invalidateQueries({ queryKey: ["links"] });
		},
		onError: (err) => {
			if (err instanceof ApiError && err.status === 409) {
				form.setError("url", { message: t("linkForm.errors.duplicate") });
			} else if (
				err instanceof ApiError &&
				err.status === 400 &&
				Array.isArray(err.body.issues)
			) {
				for (const [field, e] of Object.entries(
					fieldErrors(err.body.issues as Issue[], t),
				)) {
					form.setError(field as keyof FormValues, e);
				}
			} else if (err instanceof ApiError && err.status === 401) {
				window.dispatchEvent(new Event("linkwatch:api-key-invalid"));
			} else {
				form.setError("root", { message: t("linkForm.errors.unknown") });
			}
		},
	});

	return (
		<form
			onSubmit={form.handleSubmit((input) => create.mutate(input))}
			noValidate
		>
			<Group align="flex-end" wrap="wrap" gap="xl">
				<TextInput
					label={t("linkForm.url")}
					placeholder="https://example.com/page"
					required
					classNames={underline}
					style={{ flex: "2 1 320px" }}
					error={form.formState.errors.url?.message}
					{...form.register("url")}
				/>
				<TextInput
					label={t("linkForm.name")}
					classNames={underline}
					style={{ flex: "1 1 200px" }}
					error={form.formState.errors.name?.message}
					{...form.register("name")}
				/>
				<Button
					type="submit"
					variant="subtle"
					px={0}
					loading={create.isPending}
					rightSection={<IconArrowRight size={18} />}
					styles={{ label: { fontSize: 16, fontWeight: 500 } }}
				>
					{t("linkForm.add")}
				</Button>
			</Group>
			{form.formState.errors.root && (
				<div
					role="alert"
					style={{ color: "var(--mantine-color-red-7)", marginTop: 8 }}
				>
					{form.formState.errors.root.message}
				</div>
			)}
		</form>
	);
}
