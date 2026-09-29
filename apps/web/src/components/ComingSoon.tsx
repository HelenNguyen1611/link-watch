"use client";

import { Anchor, Text } from "@mantine/core";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { PageHeader } from "./PageHeader";

/** Trang giữ chỗ cho màn hình chưa làm, để menu không dẫn tới 404. */
export function ComingSoon({
	navKey,
	screen,
	milestone,
}: {
	navKey: string;
	screen: string;
	milestone: 2 | 3;
}) {
	const { t } = useTranslation();
	return (
		<>
			<PageHeader
				title={t(`nav.${navKey}`)}
				description={t(`comingSoon.desc.${navKey}`)}
			/>
			<Text
				size="sm"
				c="dimmed"
				py="lg"
				style={{ borderTop: "1px solid var(--mantine-color-gray-2)" }}
			>
				{t("comingSoon.status", { screen, milestone })}
			</Text>
			<Anchor component={Link} href="/links/" size="sm" fw={500}>
				{t("comingSoon.goLinks")} →
			</Anchor>
		</>
	);
}
