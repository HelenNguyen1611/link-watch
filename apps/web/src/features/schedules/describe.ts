import type { ScheduleRule } from "@linkwatch/core";

type T = (key: string, opts?: Record<string, unknown>) => string;

/** FR-12: a schedule in words, e.g. "Every 15 minutes", "Mon, Fri at 07:00". */
export function describeRule(rule: ScheduleRule, t: T): string {
	switch (rule.kind) {
		case "interval":
			return rule.minutes < 60
				? t("schedules.describe.everyMinutes", { count: rule.minutes })
				: t("schedules.describe.everyHours", { count: rule.minutes / 60 });
		case "daily":
			return t("schedules.describe.daily", { at: rule.at });
		case "weekly":
			return rule.days.length === 7
				? t("schedules.describe.daily", { at: rule.at })
				: t("schedules.describe.weekly", {
						days: rule.days.map((d) => t(`schedules.weekdays.${d}`)).join(", "),
						at: rule.at,
					});
		case "monthly":
			return t("schedules.describe.monthly", {
				days: rule.days.join(", "),
				at: rule.at,
			});
	}
}
