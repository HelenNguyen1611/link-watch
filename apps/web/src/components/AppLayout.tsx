"use client";

import {
	Anchor,
	AppShell,
	Box,
	Burger,
	Group,
	Text,
	useMantineTheme,
} from "@mantine/core";
import { useDisclosure, useLocalStorage, useMediaQuery } from "@mantine/hooks";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ApiKeyGate } from "./ApiKeyGate";
import { Logo } from "./Logo";
import {
	SHELL_GUTTER,
	SIDEBAR_COLLAPSED_WIDTH,
	SIDEBAR_WIDTH,
	Sidebar,
} from "./Sidebar";

export const SIDEBAR_STORAGE_KEY = "linkwatch.sidebarCollapsed";

/** Page shell: slim header, collapsible left sidebar, centred content up to 1152 px wide. */
export function AppLayout({ children }: { children: ReactNode }) {
	const { t } = useTranslation();
	const pathname = usePathname() ?? "/";
	const theme = useMantineTheme();
	// Same breakpoint as the AppShell navbar: below it the sidebar is the ☰ drawer.
	const desktop = useMediaQuery(`(min-width: ${theme.breakpoints.sm})`);
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
				{/* Logo on the left; tagline (desktop) and the menu button (mobile) on the right. */}
				<Group h="100%" px={SHELL_GUTTER} justify="space-between" wrap="nowrap">
					<Anchor
						component={Link}
						href="/"
						underline="never"
						c="inherit"
						onClick={closeMobile}
					>
						<Logo label={t("app.title")} />
					</Anchor>
					<Group gap="sm" wrap="nowrap">
						<Text size="sm" c="dimmed" visibleFrom="md">
							{t("app.tagline")}
						</Text>
						<Burger
							opened={mobileOpened}
							onClick={toggleMobile}
							hiddenFrom="sm"
							size="sm"
							aria-label={t("nav.menu")}
						/>
					</Group>
				</Group>
			</AppShell.Header>
			<AppShell.Navbar>
				<Sidebar
					pathname={pathname}
					collapsed={collapsed}
					onToggleCollapsed={() => setCollapsed((c) => !c)}
					onNavigate={closeMobile}
					mobile={!desktop}
				/>
			</AppShell.Navbar>
			<AppShell.Main>
				{/* Full viewport height minus the header, so the footer always sits at the bottom. */}
				<Box
					maw={1152}
					mx="auto"
					px={{ base: "md", sm: 48 }}
					pt={{ base: "lg", sm: 56 }}
					pb="lg"
					mih="calc(100dvh - var(--app-shell-header-height, 64px))"
					style={{ display: "flex", flexDirection: "column" }}
				>
					<Box style={{ flex: 1 }}>
						<ApiKeyGate>{children}</ApiKeyGate>
					</Box>
					<Text
						component="footer"
						size="xs"
						c="dimmed"
						mt={64}
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
