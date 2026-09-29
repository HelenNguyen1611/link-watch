import { z } from "zod";

/** FR-01: phương thức request. */
export const HttpMethod = z.enum(["GET", "HEAD"]);
export type HttpMethod = z.infer<typeof HttpMethod>;

/** SRS 5.1: kết quả của một lần check. */
export const CheckResultKind = z.enum(["up", "slow", "dead", "down"]);
export type CheckResultKind = z.infer<typeof CheckResultKind>;

/**
 * Trạng thái hiện tại của link: `pending` = chưa check lần nào,
 * `suspect` = Nghi ngờ sau lần lỗi đầu (SRS 5.2 bước 1). Tạm dừng là cờ `paused` riêng (FR-04).
 */
export const LinkStatus = z.enum([
	"pending",
	"up",
	"slow",
	"dead",
	"down",
	"suspect",
]);
export type LinkStatus = z.infer<typeof LinkStatus>;

/** SRS 6.2: Đang mở / Chờ xác minh / Đã đóng. */
export const IncidentState = z.enum(["open", "verifying", "closed"]);
export type IncidentState = z.infer<typeof IncidentState>;

/** Chỉ lỗi thật mới mở incident; Chậm không mở (SRS 5.1). */
export const IncidentType = z.enum(["dead", "down"]);
export type IncidentType = z.infer<typeof IncidentType>;
