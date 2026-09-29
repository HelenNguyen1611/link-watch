"use client";

import { Anchor, AppShell, Box, Burger, Group, Text } from "@mantine/core";
import { useDisclosure, useLocalStorage } from "@mantine/hooks";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ApiKeyGate } from "./ApiKeyGate";
import { Logo } from "./Logo";
import { SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_WIDTH, Sidebar } from "./Sidebar";

export const SIDEBAR_STORAGE_KEY = "linkwatch.sidebarCollapsed";

/** Page shell: slim header, collapsible left sidebar, centred content up to 1152 px wide. */
export function AppLayout({ children }: { children: ReactNode }) {
	const { t } = useTranslation();
	const pathname = usePathname() ?? "/";
	const [mobileOpened, { toggle: toggleMobile, close: closeMobile }] =
		useDisclosure(false);
	const [collapsed, setCollapsed] = useLocalStorage({
		key: SIDEBAR_STORAGE_KEY,
		defaultValue: false,
		getInitialValueInEffect: true,
	});

	return (
		<AppShell
			header={{ height: 64 }}
			navbar={{
				width: {
					base: SIDEBAR_WIDTH,
					sm: collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH,
				},
				breakpoint: "sm",
				collapsed: { mobile: !mobileOpened },
			}}
			padding={0}
			withBorder
		>
			<AppShell.Header>
				<Group h="100%" px="lg" justify="space-between" wrap="nowrap">
					<Group gap="sm" wrap="nowrap">
						<Burger
							opened={mobileOpened}
							onClick={toggleMobile}
							hiddenFrom="sm"
							size="sm"
							aria-label={t("nav.menu")}
						/>
						<Anchor
							component={Link}
							href="/"
							underline="never"
							c="inherit"
							onClick={closeMobile}
						>
							<Logo label={t("app.title")} />
						</Anchor>
					</Group>
					<Text size="sm" c="dimmed" visibleFrom="md">
						{t("app.tagline")}
					</Text>
				</Group>
			</AppShell.Header>
			<AppShell.Navbar>
				<Sidebar
					pathname={pathname}
					collapsed={collapsed}
					onToggleCollapsed={() => setCollapsed((c) => !c)}
					onNavigate={closeMobile}
				/>
			</AppShell.Navbar>
			<AppShell.Main>
				<Box
					maw={1152}
					mx="auto"
					px={{ base: "md", sm: 48 }}
					py={{ base: "lg", sm: 56 }}
				>
					<ApiKeyGate>{children}</ApiKeyGate>
					<Text
						size="xs"
						c="dimmed"
						mt={96}
						pt="md"
						style={{ borderTop: "1px solid var(--mantine-color-gray-2)" }}
					>
						{t("app.footer")}
					</Text>
				</Box>
			</AppShell.Main>
		</AppShell>
	);
}
