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
import { useCan } from "@/lib/auth-context";
import { isActive, MAIN_NAV, type NavItem, SETTINGS_NAV } from "@/lib/nav";
import { IconChevronLeft, IconChevronRight, IconSettings } from "./icons";

/** Expanded sidebar: 248 px on wide screens, shrinking to 180 px at the `sm` breakpoint. */
export const SIDEBAR_WIDTH = 248;
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_COLLAPSED_WIDTH = 72;
/** Viewport widths between which the expanded sidebar grows from min to max (sm = 48em). */
export const SIDEBAR_FLUID_FROM = 768;
export const SIDEBAR_FLUID_TO = 1440;

/**
 * CSS width growing linearly from `min` px at a `from` px viewport to `max` px at `to` px,
 * clamped outside that range: `clamp(min, a px + b vw, max)`.
 */
export function fluidWidth(
	min: number,
	max: number,
	from: number,
	to: number,
): string {
	const slope = (max - min) / (to - from);
	const intercept = min - slope * from;
	const px = Math.round(intercept * 100) / 100;
	const vw = Math.round(slope * 100 * 10_000) / 10_000;
	return `clamp(${min}px, ${px}px + ${vw}vw, ${max}px)`;
}

/** Expanded sidebar width on desktop (the mobile drawer keeps SIDEBAR_WIDTH). */
export const SIDEBAR_FLUID_WIDTH = fluidWidth(
	SIDEBAR_MIN_WIDTH,
	SIDEBAR_WIDTH,
	SIDEBAR_FLUID_FROM,
	SIDEBAR_FLUID_TO,
);

type Props = {
	pathname: string;
	collapsed: boolean;
	onToggleCollapsed: () => void;
	/** Mobile drawer: always show labels, ignoring the desktop "collapsed" preference. */
	mobile?: boolean;
	/** Closes the sidebar on mobile after an item is chosen. */
	onNavigate?: () => void;
};

/** Active-item marker drawn as an inset shadow so it never shifts the icon. */
const activeMarker = (active: boolean) =>
	active ? "inset 2px 0 0 var(--mantine-color-brand-7)" : undefined;

export const ICON_SIZE = 20;
/** Left inset shared by the header logo and the menu, so icons line up under the logo. */
export const SHELL_GUTTER = "md";

function Item({
	item,
	pathname,
	collapsed,
	onNavigate,
}: { item: NavItem } & Omit<Props, "onToggleCollapsed" | "mobile">) {
	const { t } = useTranslation();
	const label = t(`nav.${item.key}`);
	const active = isActive(item.href, pathname);
	const Icon = item.icon;

	if (collapsed) {
		// Icon-only square, centred in the rail; the label is available via aria-label and tooltip.
		return (
			<Tooltip label={label} position="right" withArrow>
				<UnstyledButton
					component={Link}
					href={item.href}
					aria-label={label}
					aria-current={active ? "page" : undefined}
					onClick={onNavigate}
					h={44}
					w="100%"
					c={active ? "brand.7" : "dark.6"}
					bg={active ? "brand.0" : undefined}
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						boxShadow: activeMarker(active),
					}}
				>
					<Icon size={ICON_SIZE} />
				</UnstyledButton>
			</Tooltip>
		);
	}

	return (
		<NavLink
			component={Link}
			href={item.href}
			label={label}
			aria-current={active ? "page" : undefined}
			leftSection={<Icon size={ICON_SIZE} />}
			active={active}
			variant="subtle"
			onClick={onNavigate}
			styles={{
				root: {
					borderRadius: 0,
					paddingBlock: 10,
					paddingInline: `var(--mantine-spacing-${SHELL_GUTTER})`,
					boxShadow: activeMarker(active),
				},
				label: { fontWeight: active ? 500 : 400, fontSize: 15 },
			}}
		/>
	);
}

/** Left sidebar: main menu + Settings group; collapses to icons (desktop), opened with ☰ (mobile). */
export function Sidebar({
	pathname,
	collapsed: collapsedPref,
	onToggleCollapsed,
	onNavigate,
	mobile = false,
}: Props) {
	const { t } = useTranslation();
	const allowed = useCan();
	// The icon-only rail is desktop-only; the mobile drawer is full width, so labels always show.
	const collapsed = collapsedPref && !mobile;
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
						<Text
							c="dimmed"
							aria-hidden="true"
							h={32}
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
							}}
						>
							<IconSettings size={ICON_SIZE} />
						</Text>
					</Tooltip>
				) : (
					<Text size="xs" c="dimmed" px={SHELL_GUTTER} mb={6} fw={500}>
						{t("nav.settings")}
					</Text>
				)}
				<Stack gap={2}>
					{SETTINGS_NAV.filter(
						(item) => !item.requires || allowed(item.requires),
					).map((item) => (
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
			{/* Desktop-only toggle, so it reflects the stored preference. */}
			<AppShell.Section
				visibleFrom="sm"
				py="sm"
				style={{ borderTop: "1px solid var(--mantine-color-gray-2)" }}
			>
				<UnstyledButton
					onClick={onToggleCollapsed}
					aria-label={collapsedPref ? t("nav.expand") : t("nav.collapse")}
					aria-expanded={!collapsedPref}
					w="100%"
					px={SHELL_GUTTER}
					py={6}
					c="dimmed"
					style={{
						display: "flex",
						alignItems: "center",
						gap: 8,
						justifyContent: collapsedPref ? "center" : "flex-start",
					}}
				>
					{collapsedPref ? (
						<IconChevronRight size={ICON_SIZE} />
					) : (
						<IconChevronLeft size={ICON_SIZE} />
					)}
					{!collapsedPref && <Text size="sm">{t("nav.collapse")}</Text>}
				</UnstyledButton>
			</AppShell.Section>
		</>
	);
}
