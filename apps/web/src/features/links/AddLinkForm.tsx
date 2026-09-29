"use client";

import { LinkInput, type LinkInputRaw } from "@linkwatch/core";
import { Box, Button, Flex, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { type FieldErrors, type Resolver, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { IconArrowRight, IconPlus } from "@/components/icons";
import underline from "@/components/underline.module.css";
import { ApiError } from "@/lib/api";
import { useApi } from "@/lib/api-context";
import { COLOR, PALETTE } from "@/lib/colors";
import classes from "./add-link-form.module.css";

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
	// Collapsed: a single "+ Add" button. Open: the fields with "Add link" and Cancel.
	const [open, setOpen] = useState(false);
	const addButton = useRef<HTMLButtonElement>(null);
	const wasOpen = useRef(false);
	// Bumped after each successful add so the URL field is refocused once the reset has rendered.
	const [added, setAdded] = useState(0);

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

	// Focus the URL field on open; give focus back to "+ Add" on close.
	useEffect(() => {
		if (open) form.setFocus("url");
		else if (wasOpen.current) addButton.current?.focus();
		wasOpen.current = open;
	}, [open, form]);

	useEffect(() => {
		if (added > 0) form.setFocus("url");
	}, [added, form]);

	const close = () => {
		form.reset();
		setOpen(false);
	};

	const create = useMutation({
		mutationFn: (input: LinkInputRaw) => api.createLink(input),
		onSuccess: () => {
			// Stay open so several links can be added in a row.
			form.reset();
			setAdded((n) => n + 1);
			notifications.show({
				color: PALETTE.success,
				message: t("linkForm.added"),
			});
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

	if (!open)
		return (
			<Button
				ref={addButton}
				variant="light"
				h={44}
				px="md"
				leftSection={<IconPlus size={18} />}
				styles={{ label: { fontSize: 16, fontWeight: 500 } }}
				onClick={() => setOpen(true)}
			>
				{t("linkForm.add")}
			</Button>
		);

	return (
		<form
			className={classes.form}
			onSubmit={form.handleSubmit((input) => create.mutate(input))}
			onKeyDown={(e) => {
				if (e.key === "Escape") close();
			}}
			noValidate
		>
			{/* Desktop: URL, name and actions in one row. Mobile: stacked, full-width submit. */}
			<Flex
				direction={{ base: "column", sm: "row" }}
				align={{ base: "stretch", sm: "flex-end" }}
				gap="md"
			>
				<Flex
					direction={{ base: "column", sm: "row" }}
					gap="md"
					style={{ flex: 1, minWidth: 0 }}
					data-form-fields
				>
					<TextInput
						label={t("linkForm.url")}
						placeholder="https://example.com/page"
						required
						classNames={underline}
						style={{ flex: 2, minWidth: 0 }}
						error={form.formState.errors.url?.message}
						{...form.register("url")}
					/>
					<TextInput
						label={t("linkForm.name")}
						placeholder={t("linkForm.namePlaceholder")}
						classNames={underline}
						style={{ flex: 1, minWidth: 0 }}
						error={form.formState.errors.name?.message}
						{...form.register("name")}
					/>
				</Flex>
				{/* One row on every screen: Cancel on the left, Add link on the right. */}
				<Flex
					align="center"
					gap="xs"
					style={{ flexShrink: 0 }}
					data-form-actions
				>
					<Button variant="subtle" color="gray" h={44} onClick={close}>
						{t("linkForm.cancel")}
					</Button>
					<Button
						type="submit"
						variant="light"
						h={44}
						px="md"
						style={{ flexGrow: 1 }}
						loading={create.isPending}
						rightSection={<IconArrowRight size={18} />}
						styles={{ label: { fontSize: 16, fontWeight: 500 } }}
					>
						{t("linkForm.submit")}
					</Button>
				</Flex>
			</Flex>
			{form.formState.errors.root && (
				<Box role="alert" mt={8} style={{ color: COLOR.danger }}>
					{form.formState.errors.root.message}
				</Box>
			)}
		</form>
	);
}
