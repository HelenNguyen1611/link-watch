import type { ComponentType, SVGProps } from "react";
import {
	IconAlert,
	IconCalendar,
	IconGlobe,
	IconKey,
	IconLink,
	IconMail,
	IconOverview,
	IconUser,
} from "@/components/icons";

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

export type NavItem = {
	/** Khóa i18n trong nav.* */
	key: string;
	href: string;
	icon: IconComponent;
	/** Màn hình trong SRS/wireframe. */
	screen: string;
};

/** Menu chính (SRS 4, wireframe SCR-01 … SCR-07). */
export const MAIN_NAV: NavItem[] = [
	{ key: "overview", href: "/", icon: IconOverview, screen: "SCR-01" },
	{ key: "domains", href: "/domains/", icon: IconGlobe, screen: "SCR-02" },
	{ key: "links", href: "/links/", icon: IconLink, screen: "SCR-03" },
	{
		key: "schedules",
		href: "/schedules/",
		icon: IconCalendar,
		screen: "SCR-06",
	},
	{ key: "incidents", href: "/incidents/", icon: IconAlert, screen: "SCR-07" },
];

/** Nhóm Cài đặt (SCR-08/09 + khóa API tạm của Mốc 1). */
export const SETTINGS_NAV: NavItem[] = [
	{
		key: "settingsEmail",
		href: "/settings/email/",
		icon: IconMail,
		screen: "SCR-08",
	},
	{
		key: "settingsAccount",
		href: "/settings/account/",
		icon: IconUser,
		screen: "SCR-09",
	},
	{
		key: "settingsApiKey",
		href: "/settings/api-key/",
		icon: IconKey,
		screen: "—",
	},
];

/** Mục đang mở: "/" chỉ khớp đúng trang chủ, mục khác khớp theo tiền tố. */
export function isActive(href: string, pathname: string): boolean {
	const path = pathname.endsWith("/") ? pathname : `${pathname}/`;
	return href === "/" ? path === "/" : path.startsWith(href);
}
