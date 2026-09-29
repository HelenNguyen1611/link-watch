"use client";

import { Button, Card, PasswordInput, Stack, Text, Title } from "@mantine/core";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getApiKey, setApiKey } from "@/lib/api-key";

/** TEMPORARY (removed in step 23b): shows the API key form until a key is stored. */
export function ApiKeyGate({ children }: { children: ReactNode }) {
	const { t } = useTranslation();
	const [hasKey, setHasKey] = useState<boolean | null>(null);
	const [value, setValue] = useState("");

	useEffect(() => {
		setHasKey(getApiKey() !== null);
		const onInvalid = () => setHasKey(false);
		window.addEventListener("linkwatch:api-key-invalid", onInvalid);
		return () =>
			window.removeEventListener("linkwatch:api-key-invalid", onInvalid);
	}, []);

	if (hasKey === null) return null;
	if (hasKey) return <>{children}</>;

	const submit = (e: FormEvent) => {
		e.preventDefault();
		if (!value.trim()) return;
		setApiKey(value);
		setHasKey(true);
	};
	return (
		<Card withBorder maw={420} mx="auto" mt="xl" padding="lg">
			<form onSubmit={submit}>
				<Stack>
					<Title order={3}>{t("apiKey.title")}</Title>
					<Text size="sm" c="dimmed">
						{t("apiKey.description")}
					</Text>
					<PasswordInput
						label={t("apiKey.label")}
						value={value}
						onChange={(e) => setValue(e.currentTarget.value)}
						autoFocus
					/>
					<Button type="submit">{t("apiKey.save")}</Button>
				</Stack>
			</form>
		</Card>
	);
}
