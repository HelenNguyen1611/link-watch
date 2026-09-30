"use client";

import { Button, Card, Group, Stack, Text } from "@mantine/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/lib/auth-context";

/** SCR-09 (MVP): the signed-in account; managing users (FR-29) is phase 2. */
export function AccountPage() {
	const { t } = useTranslation();
	const { user, signOut } = useAuth();
	const [leaving, setLeaving] = useState(false);
	return (
		<>
			<PageHeader
				title={t("nav.settingsAccount")}
				description={t("account.subtitle")}
				mb={24}
			/>
			<Card withBorder radius="md" padding="lg" maw={560}>
				<Stack gap="md">
					<Stack gap={2}>
						<Text size="xs" c="dimmed">
							{t("account.email")}
						</Text>
						<Text fw={500} data-testid="account-email">
							{user?.email ?? "—"}
						</Text>
					</Stack>
					<Stack gap={2}>
						<Text size="xs" c="dimmed">
							{t("account.role")}
						</Text>
						<Text>{t("account.admin")}</Text>
					</Stack>
					<Text size="sm" c="dimmed">
						{t("account.password")}
					</Text>
					<Text size="sm" c="dimmed">
						{t("account.users")}
					</Text>
					<Group>
						<Button
							variant="light"
							color="gray"
							loading={leaving}
							onClick={async () => {
								setLeaving(true);
								try {
									await signOut();
								} finally {
									setLeaving(false);
								}
							}}
						>
							{t("account.signOut")}
						</Button>
					</Group>
				</Stack>
			</Card>
		</>
	);
}
