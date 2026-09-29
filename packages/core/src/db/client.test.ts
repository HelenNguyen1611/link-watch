import { describe, expect, it } from "vitest";
import { createRawClient } from "./client";

describe("createRawClient", () => {
	it("local endpoint → region 'local' so the API, workers and db:init see the same table", async () => {
		expect(
			await createRawClient({
				endpoint: "http://localhost:8000",
			}).config.region(),
		).toBe("local");
	});

	it("no endpoint → AWS region", async () => {
		expect(
			await createRawClient({ region: "ap-southeast-1" }).config.region(),
		).toBe("ap-southeast-1");
	});
});
