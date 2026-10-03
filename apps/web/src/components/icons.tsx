import type { SVGProps } from "react";

/** Stroke icon set (24×24, stroke = currentColor) for the sidebar and buttons. */
function Icon({
	children,
	size = 20,
	...props
}: SVGProps<SVGSVGElement> & { size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.75}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			focusable="false"
			{...props}
		>
			{children}
		</svg>
	);
}

type P = SVGProps<SVGSVGElement> & { size?: number };

export const IconOverview = (p: P) => (
	<Icon {...p}>
		<rect x="3.5" y="3.5" width="7" height="7" rx="1" />
		<rect x="13.5" y="3.5" width="7" height="7" rx="1" />
		<rect x="3.5" y="13.5" width="7" height="7" rx="1" />
		<rect x="13.5" y="13.5" width="7" height="7" rx="1" />
	</Icon>
);
export const IconGlobe = (p: P) => (
	<Icon {...p}>
		<circle cx="12" cy="12" r="8.5" />
		<path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5z" />
	</Icon>
);
export const IconLink = (p: P) => (
	<Icon {...p}>
		<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
		<path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
	</Icon>
);
export const IconCalendar = (p: P) => (
	<Icon {...p}>
		<rect x="3.5" y="5" width="17" height="15.5" rx="2" />
		<path d="M3.5 10h17M8 3v4M16 3v4" />
	</Icon>
);
export const IconAlert = (p: P) => (
	<Icon {...p}>
		<path d="M12 4 21 19.5H3z" />
		<path d="M12 10v4M12 17h.01" />
	</Icon>
);
export const IconMail = (p: P) => (
	<Icon {...p}>
		<rect x="3.5" y="5.5" width="17" height="13" rx="2" />
		<path d="m4 7 8 6 8-6" />
	</Icon>
);
export const IconUser = (p: P) => (
	<Icon {...p}>
		<circle cx="12" cy="8.5" r="3.5" />
		<path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
	</Icon>
);
export const IconUsers = (p: P) => (
	<Icon {...p}>
		<circle cx="9" cy="8.5" r="3.5" />
		<path d="M2.5 20c.7-3.4 3.2-5.5 6.5-5.5s5.8 2.1 6.5 5.5" />
		<path d="M15.5 5.2a3.5 3.5 0 0 1 0 6.6M18 14.8c1.8.8 3 2.6 3.5 5.2" />
	</Icon>
);
export const IconKey = (p: P) => (
	<Icon {...p}>
		<circle cx="8" cy="15" r="4" />
		<path d="m11 12 8.5-8.5M16 7l2.5 2.5M14 9l2 2" />
	</Icon>
);
export const IconSettings = (p: P) => (
	<Icon {...p}>
		<path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
		<circle cx="16" cy="7" r="2" />
		<circle cx="10" cy="17" r="2" />
	</Icon>
);
export const IconChevronLeft = (p: P) => (
	<Icon {...p}>
		<path d="m14.5 6-6 6 6 6" />
	</Icon>
);
export const IconChevronDown = (p: P) => (
	<Icon {...p}>
		<path d="m6 9.5 6 6 6-6" />
	</Icon>
);
export const IconLogout = (p: P) => (
	<Icon {...p}>
		<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10" />
	</Icon>
);
export const IconChevronRight = (p: P) => (
	<Icon {...p}>
		<path d="m9.5 6 6 6-6 6" />
	</Icon>
);
export const IconPlus = (p: P) => (
	<Icon {...p}>
		<path d="M12 5v14M5 12h14" />
	</Icon>
);
export const IconArrowRight = (p: P) => (
	<Icon {...p}>
		<path d="M5 12h14M13 6l6 6-6 6" />
	</Icon>
);
export const IconCircleCheck = (p: P) => (
	<Icon {...p}>
		<circle cx="12" cy="12" r="8.5" />
		<path d="m8.5 12.2 2.4 2.4 4.6-4.9" />
	</Icon>
);
export const IconClock = (p: P) => (
	<Icon {...p}>
		<circle cx="12" cy="12" r="8.5" />
		<path d="M12 7.5V12l3 2" />
	</Icon>
);
export const IconUnlink = (p: P) => (
	<Icon {...p}>
		<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
		<path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
		<path d="m3.5 3.5 17 17" />
	</Icon>
);
export const IconCircleX = (p: P) => (
	<Icon {...p}>
		<circle cx="12" cy="12" r="8.5" />
		<path d="m9.5 9.5 5 5M14.5 9.5l-5 5" />
	</Icon>
);
export const IconHourglass = (p: P) => (
	<Icon {...p}>
		<path d="M7 3.5h10M7 20.5h10M8 3.5c0 4 8 5 8 8.5s-8 4.5-8 8.5M16 3.5c0 4-8 5-8 8.5s8 4.5 8 8.5" />
	</Icon>
);
export const IconHelp = (p: P) => (
	<Icon {...p}>
		<circle cx="12" cy="12" r="8.5" />
		<path d="M9.8 9.5a2.3 2.3 0 0 1 4.4.8c0 1.6-2.2 2-2.2 3.4M12 16.8h.01" />
	</Icon>
);
export const IconTrash = (p: P) => (
	<Icon {...p}>
		<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" />
	</Icon>
);
export const IconArrowUp = (p: P) => (
	<Icon {...p}>
		<path d="M12 19V5M6 11l6-6 6 6" />
	</Icon>
);
export const IconArrowDown = (p: P) => (
	<Icon {...p}>
		<path d="M12 5v14M6 13l6 6 6-6" />
	</Icon>
);
/** Unsorted column: up/down chevrons. */
export const IconSelector = (p: P) => (
	<Icon {...p}>
		<path d="M8 9l4-4 4 4M8 15l4 4 4-4" />
	</Icon>
);
export const IconSearch = (p: P) => (
	<Icon {...p}>
		<circle cx="11" cy="11" r="6.5" />
		<path d="M20 20l-4.2-4.2" />
	</Icon>
);
export const IconRefresh = (p: P) => (
	<Icon {...p}>
		<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" />
	</Icon>
);
