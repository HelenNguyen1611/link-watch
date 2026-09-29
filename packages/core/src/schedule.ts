/** Asia/Saigon không có giờ mùa hè → offset cố định +07:00 (PLAN: quyết định kỹ thuật). */
export const TZ_OFFSET_MS = 7 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** FR-14: độ lệch tối đa khi dàn đều các check cùng mốc giờ. */
export const JITTER_MAX_MS = 5 * 60_000;

/** Lịch giờ cố định hàng ngày, `at` = "HH:mm" giờ Asia/Saigon. Các kiểu khác thêm ở Bước 3b. */
export type DailySchedule = { kind: "daily"; at: string };
export type Schedule = DailySchedule;

/** FR-11: lịch mặc định toàn hệ thống. */
export const DEFAULT_SCHEDULE: Schedule = { kind: "daily", at: "06:00" };

function parseHHmm(at: string): number {
	const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(at);
	if (!m)
		throw new Error(`Giờ không hợp lệ (cần HH:mm): ${JSON.stringify(at)}`);
	return (Number(m[1]) * 60 + Number(m[2])) * 60_000;
}

/** Lượt kế tiếp của lịch, luôn sau `after` (không tính jitter). */
export function computeNextRun(schedule: Schedule, after: Date): Date {
	const timeOfDay = parseHHmm(schedule.at);
	const localNow = after.getTime() + TZ_OFFSET_MS;
	const localMidnight = localNow - (((localNow % DAY_MS) + DAY_MS) % DAY_MS);
	let next = localMidnight + timeOfDay - TZ_OFFSET_MS;
	if (next <= after.getTime()) next += DAY_MS;
	return new Date(next);
}

/** FNV-1a 32 bit + fmix32 (MurmurHash3): ổn định giữa các lần chạy, phân bố đều cả khi id gần giống nhau. */
function hash32(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	h ^= h >>> 16;
	h = Math.imul(h, 0x85ebca6b);
	h ^= h >>> 13;
	h = Math.imul(h, 0xc2b2ae35);
	h ^= h >>> 16;
	return h >>> 0;
}

/** FR-14: lệch cố định theo link id trong [0, 5 phút) để dàn đều các check cùng mốc giờ. */
export function applyJitter(base: Date, linkId: string): Date {
	const offset = Math.floor((hash32(linkId) / 2 ** 32) * JITTER_MAX_MS);
	return new Date(base.getTime() + offset);
}

/** `next_run_at` của link: lượt kế tiếp theo lịch + jitter. */
export function nextRunAt(schedule: Schedule, linkId: string, now: Date): Date {
	return applyJitter(computeNextRun(schedule, now), linkId);
}
