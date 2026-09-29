"use client";

import { Anchor, AppShell, Button, Group, Text, Title } from "@mantine/core";
import Link from "next/link";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { clearApiKey } from "@/lib/api-key";
import { ApiKeyGate } from "./ApiKeyGate";

export function AppLayout({ children }: { children: ReactNode }) {
	const { t } = useTranslation();
	const changeKey = () => {
		clearApiKey();
		window.dispatchEvent(new Event("linkwatch:api-key-invalid"));
	};
	return (
		<AppShell header={{ height: 56 }} padding="md">
			<AppShell.Header>
				<Group h="100%" px="md" justify="space-between">
					<Group gap="lg">
						<Anchor component={Link} href="/" underline="never" c="inherit">
							<Title order={4}>{t("app.title")}</Title>
						</Anchor>
						<Anchor component={Link} href="/links/">
							{t("nav.links")}
						</Anchor>
					</Group>
					<Group gap="sm">
						<Text size="xs" c="dimmed" visibleFrom="sm">
							{t("app.tagline")}
						</Text>
						<Button variant="subtle" size="xs" onClick={changeKey}>
							{t("apiKey.change")}
						</Button>
					</Group>
				</Group>
			</AppShell.Header>
			<AppShell.Main>
				<ApiKeyGate>{children}</ApiKeyGate>
			</AppShell.Main>
		</AppShell>
	);
}
