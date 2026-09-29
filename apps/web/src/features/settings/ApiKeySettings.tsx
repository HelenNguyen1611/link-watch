"use client";

import { Button, Group, Text } from "@mantine/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/PageHeader";
import { clearApiKey, getApiKey } from "@/lib/api-key";

/** Chỉ hiện 4 ký tự cuối của khóa. */
export const maskKey = (key: string) => `••••${key.slice(-4)}`;

/** TẠM THỜI (Mốc 1, bỏ ở Bước 23b khi có Cognito): xem và đổi khóa API lưu trên trình duyệt. */
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
