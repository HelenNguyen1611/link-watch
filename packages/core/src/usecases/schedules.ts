import type { Db } from "../db/index";
import type { Schedule } from "../schedule";
import { ScheduleRule } from "../schema/schedule";

/**
 * FR-12 / FR-13: every schedule template as id → rule (a handful of items; loaded once per
 * Lambda invocation). Invalid stored rules are skipped (they fall through to the next level).
 */
export async function loadScheduleTemplates(
	db: Db,
): Promise<Map<string, Schedule>> {
	const { data } = await db.Schedule.query.all({}).go({ pages: "all" });
	const map = new Map<string, Schedule>();
	for (const s of data) {
		const rule = ScheduleRule.safeParse(s.rule);
		if (rule.success) map.set(s.id, rule.data);
	}
	return map;
}
