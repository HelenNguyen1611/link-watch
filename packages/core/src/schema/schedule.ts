import { z } from "zod";

/** "HH:mm" (24 h) in Asia/Saigon time. */
export const TimeOfDay = z
	.string()
	.regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "time" });

/** FR-12: interval choices; the minimum is 5 minutes (the Dispatcher tick). */
export const INTERVAL_MINUTES = [5, 15, 30, 60, 360, 720] as const;

/** ISO weekday: 1 = Monday … 7 = Sunday. */
const Weekday = z.number().int().min(1).max(7);
const MonthDay = z.number().int().min(1).max(31);
const uniqueSorted = <T extends number>(xs: T[]) =>
	[...new Set(xs)].sort((a, b) => a - b);

/** FR-12: a check schedule — interval or fixed time (daily, some weekdays, some days of the month). */
export const ScheduleRule = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("interval"),
		minutes: z.union(
			INTERVAL_MINUTES.map((m) => z.literal(m)) as [
				z.ZodLiteral<5>,
				...z.ZodLiteral<number>[],
			],
		),
	}),
	z.object({ kind: z.literal("daily"), at: TimeOfDay }),
	z.object({
		kind: z.literal("weekly"),
		days: z.array(Weekday).min(1).max(7).transform(uniqueSorted),
		at: TimeOfDay,
	}),
	z.object({
		kind: z.literal("monthly"),
		/** Day 29–31 in a shorter month runs on its last day. */
		days: z.array(MonthDay).min(1).max(31).transform(uniqueSorted),
		at: TimeOfDay,
	}),
]);
export type ScheduleRule = z.infer<typeof ScheduleRule>;
export type ScheduleRuleInput = z.input<typeof ScheduleRule>;

/** FR-11: id of the system default schedule (editable by the admin). */
export const DEFAULT_SCHEDULE_ID = "default";

/** FR-12: a reusable schedule (profile). */
export const ScheduleInput = z
	.object({
		name: z.string().trim().min(1).max(100),
		rule: ScheduleRule,
	})
	.strict();
export type ScheduleInput = z.infer<typeof ScheduleInput>;

export const ScheduleView = z.object({
	id: z.string(),
	name: z.string(),
	rule: ScheduleRule,
	/** Domains and links using it directly (for the UI and delete protection). */
	usedBy: z.object({ domains: z.number(), links: z.number() }).optional(),
});
export type ScheduleView = z.infer<typeof ScheduleView>;

/** FR-13: where the effective schedule comes from. */
export const ScheduleSource = z.enum(["link", "domain", "default"]);
export type ScheduleSource = z.infer<typeof ScheduleSource>;
