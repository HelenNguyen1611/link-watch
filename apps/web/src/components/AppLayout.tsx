"use client";

import {
	Anchor,
	AppShell,
	Box,
	Burger,
	Group,
	Menu,
	Text,
	UnstyledButton,
	useMantineTheme,
} from "@mantine/core";
import { useDisclosure, useLocalStorage, useMediaQuery } from "@mantine/hooks";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { isPublicPath } from "@/lib/auth";
import { useAuth } from "@/lib/auth-context";
import { AuthGate } from "./AuthGate";
import { IconChevronDown, IconLogout, IconUser } from "./icons";
import { Logo } from "./Logo";
import {
	ICON_SIZE,
	SHELL_GUTTER,
	SIDEBAR_COLLAPSED_WIDTH,
	SIDEBAR_WIDTH,
	Sidebar,
} from "./Sidebar";

export const SIDEBAR_STORAGE_KEY = "linkwatch.sidebarCollapsed";

/**
 * Below `viewport` px the content fills the screen minus the sidebar and padding; above it,
 * it stays as wide as at exactly `viewport` px (no jump). The navbar offset is the expanded or
 * collapsed sidebar width, and 0 on mobile where the sidebar is a drawer.
 */
export const contentMaxWidth = (viewport: number) =>
	`calc(${viewport}px - var(--app-shell-navbar-offset, 0px))`;

/** Signed-in email (desktop) and Sign out, at the right of the header. */
function UserMenu() {
	const { t } = useTranslation();
	const { user, signOut } = useAuth();
	if (!user) return null;
	return (
		<Menu position="bottom-end" width={240} withinPortal>
			<Menu.Target>
				{/* Email as the user name (Cognito accounts only have an email); icon only on mobile. */}
				<UnstyledButton
					aria-label={t("auth.accountMenu", { email: user.email })}
					c="dark.6"
					px={6}
					py={6}
					style={{ display: "flex", alignItems: "center", gap: 8 }}
				>
					<IconUser size={ICON_SIZE} />
					<Text size="sm" visibleFrom="sm" truncate maw={240}>
						{user.email}
					</Text>
					<Box visibleFrom="sm" style={{ display: "flex" }}>
						<IconChevronDown size={16} />
					</Box>
				</UnstyledButton>
			</Menu.Target>
			<Menu.Dropdown>
				<Menu.Label>{t("auth.signedInAs")}</Menu.Label>
				<Text size="sm" px="sm" pb="xs" truncate>
					{user.email}
				</Text>
				<Menu.Divider />
				<Menu.Item
					leftSection={<IconLogout size={16} />}
					onClick={() => {
						signOut();
					}}
				>
					{t("auth.signOut")}
				</Menu.Item>
			</Menu.Dropdown>
		</Menu>
	);
}

/**
 * Page shell: slim header, collapsible left sidebar, content as wide as the screen up to a
 * 1920 px viewport, then capped and centred.
 * Public pages (sign-in, emailed "Fixed" link) render without the shell and without sign-in.
 */
export function AppLayout({ children }: { children: ReactNode }) {
	const pathname = usePathname() ?? "/";
	if (isPublicPath(pathname)) return <>{children}</>;
	return <Shell pathname={pathname}>{children}</Shell>;
}

function Shell({
	pathname,
	children,
}: {
	pathname: string;
	children: ReactNode;
}) {
	const { t } = useTranslation();
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
				{/* Logo on the left; user + Sign out and the menu button (mobile) on the right. */}
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
						<UserMenu />
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
					maw={contentMaxWidth(theme.other.maxViewportWidth)}
					mx="auto"
					px={{ base: "md", sm: 48 }}
					pt={{ base: "lg", sm: 56 }}
					pb="lg"
					mih="calc(100dvh - var(--app-shell-header-height, 64px))"
					style={{ display: "flex", flexDirection: "column" }}
				>
					<Box style={{ flex: 1 }}>
						<AuthGate>{children}</AuthGate>
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
