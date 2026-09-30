"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
	Button,
	Chip,
	Group,
	MultiSelect,
	Select,
	Stack,
	Text,
	TextInput,
} from "@mantine/core";
import { useEffect, useRef } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { IconSearch } from "@/components/icons";
import { EMPTY_FILTER, isFilterActive, LinkFilter } from "./filter";
import { STATUS_BY_SEVERITY } from "./status-style";

export type LinkFiltersProps = {
	/** Called with every valid change (live filtering, no submit button). */
	onChange: (filter: LinkFilter) => void;
	shown: number;
	total: number;
	/** FR-06: choices found in the loaded links. */
	domains?: string[];
	tags?: string[];
};

/** FR-06, FR-17: search by URL / domain / name; filter by status, domain, tag, paused, last check date. */
export function LinkFilters({
	onChange,
	shown,
	total,
	domains = [],
	tags = [],
}: LinkFiltersProps) {
	const { t } = useTranslation();
	const form = useForm<LinkFilter>({
		defaultValues: EMPTY_FILTER,
		resolver: zodResolver(LinkFilter),
		mode: "onChange",
	});
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;

	useEffect(() => {
		const sub = form.watch((values) => {
			const parsed = LinkFilter.safeParse(values);
			if (parsed.success) onChangeRef.current(parsed.data);
		});
		return () => sub.unsubscribe();
	}, [form]);

	const values = form.watch();
	const rangeError = form.formState.errors.checkedTo?.message;
	const clear = () => {
		form.reset(EMPTY_FILTER);
		onChangeRef.current(EMPTY_FILTER);
	};

	return (
		<Stack
			component="form"
			role="search"
			aria-label={t("links.filter.title")}
			gap="sm"
			mb="md"
			onSubmit={(e) => e.preventDefault()}
		>
			<Group align="flex-start" gap="sm" wrap="wrap">
				<TextInput
					{...form.register("q")}
					label={t("links.filter.search")}
					placeholder={t("links.filter.searchPlaceholder")}
					leftSection={<IconSearch size={16} />}
					style={{ flex: "1 1 260px" }}
				/>
				<Controller
					control={form.control}
					name="domain"
					render={({ field }) => (
						<Select
							label={t("links.filter.domain")}
							placeholder={t("links.filter.allDomains")}
							data={domains}
							value={field.value || null}
							onChange={(v) => field.onChange(v ?? "")}
							searchable
							clearable
							style={{ flex: "0 1 200px" }}
						/>
					)}
				/>
				{tags.length > 0 && (
					<Controller
						control={form.control}
						name="tags"
						render={({ field }) => (
							<MultiSelect
								label={t("links.filter.tags")}
								placeholder={
									field.value.length ? undefined : t("links.filter.anyTag")
								}
								data={tags}
								value={field.value}
								onChange={field.onChange}
								searchable
								clearable
								style={{ flex: "0 1 220px" }}
							/>
						)}
					/>
				)}
				<Controller
					control={form.control}
					name="paused"
					render={({ field }) => (
						<Select
							label={t("links.filter.paused")}
							data={(["any", "active", "paused"] as const).map((v) => ({
								value: v,
								label: t(`links.filter.pausedOptions.${v}`),
							}))}
							value={field.value}
							onChange={(v) => field.onChange(v ?? "any")}
							allowDeselect={false}
							style={{ flex: "0 1 150px" }}
						/>
					)}
				/>
				<TextInput
					{...form.register("checkedFrom")}
					type="date"
					label={t("links.filter.checkedFrom")}
					style={{ flex: "0 1 170px" }}
				/>
				<TextInput
					{...form.register("checkedTo")}
					type="date"
					label={t("links.filter.checkedTo")}
					error={
						rangeError ? t(`links.filter.errors.${rangeError}`) : undefined
					}
					style={{ flex: "0 1 170px" }}
				/>
			</Group>
			<Group justify="space-between" align="center" gap="sm">
				<Controller
					control={form.control}
					name="statuses"
					render={({ field }) => (
						<Chip.Group multiple value={field.value} onChange={field.onChange}>
							<Group gap={6} role="group" aria-label={t("links.filter.status")}>
								{STATUS_BY_SEVERITY.map((s) => (
									<Chip key={s} value={s} size="xs" variant="outline">
										{t(`status.${s}`)}
									</Chip>
								))}
							</Group>
						</Chip.Group>
					)}
				/>
				<Group gap="sm">
					<Text size="sm" c="dimmed" aria-live="polite">
						{t("links.filter.count", { shown, total })}
					</Text>
					{isFilterActive(values) && (
						<Button size="xs" variant="subtle" onClick={clear}>
							{t("links.filter.clear")}
						</Button>
					)}
				</Group>
			</Group>
		</Stack>
	);
}
