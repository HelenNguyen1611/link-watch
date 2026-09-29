import { beforeEach, describe, expect, it } from "vitest";
import { clearApiKey, getApiKey, setApiKey } from "./api-key";

beforeEach(() => localStorage.clear());

describe("api-key (tạm thời)", () => {
	it("lưu khóa trong localStorage của trình duyệt, không nhúng vào bundle", () => {
		expect(getApiKey()).toBeNull();
		setApiKey("  abc  ");
		expect(getApiKey()).toBe("abc");
		clearApiKey();
		expect(getApiKey()).toBeNull();
	});

	it("khóa rỗng coi như chưa nhập", () => {
		setApiKey("   ");
		expect(getApiKey()).toBeNull();
	});
});
