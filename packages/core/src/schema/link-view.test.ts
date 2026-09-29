import { describe, expect, it } from "vitest";
import { toLinkView } from "./link-view";

describe("toLinkView", () => {
	it("chỉ giữ trường web cần, bỏ trường nội bộ", () => {
		const view = toLinkView({
			id: "L1",
			domain: "abc.com",
			url: "https://abc.com/",
			tags: [],
			method: "GET",
			expectedCodes: [{ from: 200, to: 399 }],
			timeoutS: 30,
			status: "dead",
			paused: false,
			lastHttpCode: 404,
			lastErrorType: "http_4xx",
			createdAt: "2026-09-29T00:00:00.000Z",
			updatedAt: "2026-09-29T00:00:00.000Z",
			deletedAt: undefined,
			secret: "x",
		} as Parameters<typeof toLinkView>[0] & { secret: string });
		expect(view).not.toHaveProperty("secret");
		expect(view).not.toHaveProperty("deletedAt");
		expect(view).toMatchObject({ id: "L1", status: "dead", lastHttpCode: 404 });
	});
});
