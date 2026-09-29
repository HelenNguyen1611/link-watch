import { z } from "zod";

/** Domain chính (FR-07): chỉ hostname, hạ chữ thường; IPv6 dạng [..] như trong URL. */
export const DomainName = z
	.string()
	.trim()
	.toLowerCase()
	.min(1)
	.max(253)
	.regex(
		/^(\[[0-9a-f:.]+\]|[a-z0-9-]+(\.[a-z0-9-]+)*)$/,
		"Domain không hợp lệ",
	);
export type DomainName = z.infer<typeof DomainName>;

const Email = z.string().trim().toLowerCase().pipe(z.email());

const optionalText = (max: number) =>
	z
		.string()
		.trim()
		.max(max)
		.optional()
		.transform((v) => (v ? v : undefined));

/** FR-08: thuộc tính domain người dùng sửa được. */
export const DomainInput = z.object({
	displayName: optionalText(200),
	description: optionalText(1000),
	owner: Email.optional(),
	/** FR-20: người nhận cảnh báo của domain. */
	recipients: z
		.array(Email)
		.max(50)
		.default([])
		.transform((list) => [...new Set(list)]),
	/** FR-13: lịch riêng; không có thì dùng lịch mặc định. */
	scheduleId: z.string().min(1).optional(),
	enabled: z.boolean().default(true),
	/** SRS 5.1: gửi email khi link Chậm (mặc định tắt). */
	slowAlert: z.boolean().default(false),
	/** SRS 3.4: coi 403 từ WAF là bình thường. */
	ignoreWaf403: z.boolean().default(false),
});
export type DomainInput = z.infer<typeof DomainInput>;
