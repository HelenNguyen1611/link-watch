import type { LinkStatus } from "@linkwatch/core";
import type { ComponentType, SVGProps } from "react";
import {
	IconCircleCheck,
	IconCircleX,
	IconClock,
	IconHelp,
	IconHourglass,
	IconUnlink,
} from "@/components/icons";
import { COLOR } from "@/lib/colors";

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

/**
 * Colour + icon per status (SRS 5.1), following common UX conventions:
 * green (brand) = healthy, amber = warning, orange = broken, red = outage, grey = not checked yet.
 * Shades are dark enough to read as text on white.
 */
export const STATUS_STYLE: Record<
	LinkStatus,
	{ color: string; icon: string; Icon: IconComponent }
> = {
	up: { color: COLOR.success, icon: "circle-check", Icon: IconCircleCheck },
	slow: { color: "yellow.8", icon: "clock", Icon: IconClock },
	dead: { color: "orange.7", icon: "unlink", Icon: IconUnlink },
	down: { color: COLOR.danger, icon: "circle-x", Icon: IconCircleX },
	pending: { color: "gray.6", icon: "hourglass", Icon: IconHourglass },
	suspect: { color: "grape.7", icon: "help", Icon: IconHelp },
};

/** 4xx orange, 5xx red; success/redirect codes stay neutral. */
export function httpCodeColor(code: number | undefined): string | undefined {
	if (code === undefined) return undefined;
	if (code >= 500) return COLOR.danger;
	if (code >= 400) return "orange.7";
	return undefined;
}

/** Highlight the response time only when it made the link Slow. */
export const responseTimeColor = (status: LinkStatus) =>
	status === "slow" ? STATUS_STYLE.slow.color : undefined;
