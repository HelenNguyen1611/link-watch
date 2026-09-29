"use client";

import { Button, Container, Stack, Text, Title } from "@mantine/core";
import Link from "next/link";
import { useTranslation } from "react-i18next";

// SCR-01 Tổng quan theo domain làm ở Bước 24; Mốc 1 chỉ dẫn sang danh sách link.
export default function HomePage() {
	const { t } = useTranslation();
	return (
		<Container py="xl">
			<Stack align="flex-start">
				<Title order={1}>{t("app.title")}</Title>
				<Text c="dimmed">{t("home.intro")}</Text>
				<Button component={Link} href="/links/">
					{t("home.open")}
				</Button>
			</Stack>
		</Container>
	);
}
