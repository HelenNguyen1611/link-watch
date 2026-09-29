"use client";

import {
	AppShell,
	Divider,
	NavLink,
	Stack,
	Text,
	Tooltip,
	UnstyledButton,
} from "@mantine/core";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { isActive, MAIN_NAV, type NavItem, SETTINGS_NAV } from "@/lib/nav";
import { IconChevronLeft, IconChevronRight, IconSettings } from "./icons";

export const SIDEBAR_WIDTH = 248;
export const SIDEBAR_COLLAPSED_WIDTH = 72;

type Props = {
	pathname: string;
	collapsed: boolean;
	onToggleCollapsed: () => void;
	/** Closes the sidebar on mobile after an item is chosen. */
	onNavigate?: () => void;
};

function Item({
	item,
	pathname,
	collapsed,
	onNavigate,
}: { item: NavItem } & Omit<Props, "onToggleCollapsed">) {
	const { t } = useTranslation();
	const label = t(`nav.${item.key}`);
	const active = isActive(item.href, pathname);
	const Icon = item.icon;
	const link = (
		<NavLink
			component={Link}
			href={item.href}
			label={collapsed ? undefined : label}
			aria-label={collapsed ? label : undefined}
			aria-current={active ? "page" : undefined}
			leftSection={<Icon />}
			active={active}
			variant="subtle"
			onClick={onNavigate}
			styles={{
				root: {
					borderRadius: 0,
					borderLeft: `2px solid ${active ? "var(--mantine-color-brand-7)" : "transparent"}`,
					paddingBlock: 10,
					justifyContent: collapsed ? "center" : undefined,
				},
				section: collapsed ? { marginInlineEnd: 0 } : undefined,
				label: { fontWeight: active ? 500 : 400, fontSize: 15 },
			}}
		/>
	);
	return collapsed ? (
		<Tooltip label={label} position="right" withArrow>
			{link}
		</Tooltip>
	) : (
		link
	);
}

/** Left sidebar: main menu + Settings group; collapses to icons (desktop), opened with ☰ (mobile). */
export function Sidebar({
	pathname,
	collapsed,
	onToggleCollapsed,
	onNavigate,
}: Props) {
	const { t } = useTranslation();
	return (
		<>
			<AppShell.Section grow component="nav" aria-label={t("nav.menu")} py="md">
				<Stack gap={2}>
					{MAIN_NAV.map((item) => (
						<Item
							key={item.key}
							item={item}
							pathname={pathname}
							collapsed={collapsed}
							onNavigate={onNavigate}
						/>
					))}
				</Stack>
				<Divider my="md" color="gray.2" />
				{collapsed ? (
					<Tooltip label={t("nav.settings")} position="right" withArrow>
						<Text ta="center" c="dimmed" aria-hidden="true">
							<IconSettings size={16} />
						</Text>
					</Tooltip>
				) : (
					<Text size="xs" c="dimmed" px="md" mb={6} fw={500}>
						{t("nav.settings")}
					</Text>
				)}
				<Stack gap={2}>
					{SETTINGS_NAV.map((item) => (
						<Item
							key={item.key}
							item={item}
							pathname={pathname}
							collapsed={collapsed}
							onNavigate={onNavigate}
						/>
					))}
				</Stack>
			</AppShell.Section>
			<AppShell.Section
				visibleFrom="sm"
				py="sm"
				style={{ borderTop: "1px solid var(--mantine-color-gray-2)" }}
			>
				<UnstyledButton
					onClick={onToggleCollapsed}
					aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
					aria-expanded={!collapsed}
					w="100%"
					px="md"
					py={6}
					c="dimmed"
					style={{
						display: "flex",
						alignItems: "center",
						gap: 8,
						justifyContent: collapsed ? "center" : "flex-start",
					}}
				>
					{collapsed ? (
						<IconChevronRight size={18} />
					) : (
						<IconChevronLeft size={18} />
					)}
					{!collapsed && <Text size="sm">{t("nav.collapse")}</Text>}
				</UnstyledButton>
			</AppShell.Section>
		</>
	);
}
