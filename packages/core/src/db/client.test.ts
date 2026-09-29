import { describe, expect, it } from "vitest";
import { createRawClient } from "./client";

describe("createRawClient", () => {
	it("endpoint local → region 'local' để API, worker, db:init cùng thấy một bảng", async () => {
		expect(
			await createRawClient({
				endpoint: "http://localhost:8000",
			}).config.region(),
		).toBe("local");
	});

	it("không có endpoint → region AWS", async () => {
		expect(
			await createRawClient({ region: "ap-southeast-1" }).config.region(),
		).toBe("ap-southeast-1");
	});
});
