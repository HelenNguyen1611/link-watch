"use client";

import { Button, Group, Text } from "@mantine/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/PageHeader";
import { clearApiKey, getApiKey } from "@/lib/api-key";

/** Shows only the last 4 characters of the key. */
export const maskKey = (key: string) => `••••${key.slice(-4)}`;

/** TEMPORARY (milestone 1, removed in step 23b with Cognito): view and change the API key stored in the browser. */
export function ApiKeySettings() {
	const { t } = useTranslation();
	const [key, setKey] = useState<string | null>(null);
	useEffect(() => setKey(getApiKey()), []);

	const change = () => {
		clearApiKey();
		setKey(null);
		window.dispatchEvent(new Event("linkwatch:api-key-invalid"));
	};

	return (
		<>
			<PageHeader
				title={t("nav.settingsApiKey")}
				description={t("apiKey.settingsDescription")}
			/>
			<Group
				justify="space-between"
				py="lg"
				style={{
					borderTop: "1px solid var(--mantine-color-gray-2)",
					borderBottom: "1px solid var(--mantine-color-gray-2)",
				}}
			>
				<div>
					<Text size="sm" c="dimmed">
						{t("apiKey.stored")}
					</Text>
					<Text ff="monospace">{key ? maskKey(key) : "—"}</Text>
				</div>
				<Button variant="subtle" onClick={change}>
					{t("apiKey.change")} →
				</Button>
			</Group>
		</>
	);
}
