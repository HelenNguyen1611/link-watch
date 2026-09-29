import { describe, expect, it } from "vitest";
import { createSafeLookup } from "./safe-lookup";

const lookup = (
	host: string,
	opts: Parameters<typeof createSafeLookup>[0],
	all = false,
) =>
	new Promise<{ err: NodeJS.ErrnoException | null; address: unknown }>(
		(resolve) => {
			// biome-ignore lint/suspicious/noExplicitAny: gọi như net.connect gọi lookup
			(createSafeLookup(opts) as any)(
				host,
				{ all },
				(err: NodeJS.ErrnoException | null, address: unknown) =>
					resolve({ err, address }),
			);
		},
	);

describe("createSafeLookup", () => {
	it("NFR-07: hostname phân giải ra IP nội bộ bị chặn lúc kết nối (chống DNS rebinding)", async () => {
		const { err } = await lookup("localhost", {});
		expect(err?.code).toBe("BLOCKED_PRIVATE_ADDRESS");
	});

	it("NFR-07: Admin cho phép host thì trả địa chỉ như dns.lookup (cả dạng all)", async () => {
		const one = await lookup("localhost", { allowHosts: ["localhost"] });
		expect(one.err).toBeNull();
		expect(typeof one.address).toBe("string");
		const all = await lookup("localhost", { allowPrivate: true }, true);
		expect(Array.isArray(all.address)).toBe(true);
	});

	it("lỗi DNS được chuyển tiếp nguyên mã", async () => {
		const { err } = await lookup("khong-ton-tai.invalid", {});
		expect(err?.code).toBe("ENOTFOUND");
	});
});
