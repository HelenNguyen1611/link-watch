import { describe, expect, it } from "vitest";
import { createSafeLookup } from "./safe-lookup";

const lookup = (
	host: string,
	opts: Parameters<typeof createSafeLookup>[0],
	all = false,
) =>
	new Promise<{ err: NodeJS.ErrnoException | null; address: unknown }>(
		(resolve) => {
			// biome-ignore lint/suspicious/noExplicitAny: called the way net.connect calls lookup
			(createSafeLookup(opts) as any)(
				host,
				{ all },
				(err: NodeJS.ErrnoException | null, address: unknown) =>
					resolve({ err, address }),
			);
		},
	);

describe("createSafeLookup", () => {
	it("NFR-07: a hostname resolving to a private IP is blocked at connect time (DNS rebinding protection)", async () => {
		const { err } = await lookup("localhost", {});
		expect(err?.code).toBe("BLOCKED_PRIVATE_ADDRESS");
	});

	it("NFR-07: an admin-allowed host returns addresses like dns.lookup (including all)", async () => {
		const one = await lookup("localhost", { allowHosts: ["localhost"] });
		expect(one.err).toBeNull();
		expect(typeof one.address).toBe("string");
		const all = await lookup("localhost", { allowPrivate: true }, true);
		expect(Array.isArray(all.address)).toBe(true);
	});

	it("DNS errors are passed through with their code", async () => {
		const { err } = await lookup("does-not-exist.invalid", {});
		expect(err?.code).toBe("ENOTFOUND");
	});
});
