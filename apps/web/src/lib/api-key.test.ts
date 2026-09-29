import { beforeEach, describe, expect, it } from "vitest";
import { clearApiKey, getApiKey, setApiKey } from "./api-key";

beforeEach(() => localStorage.clear());

describe("api-key (temporary)", () => {
	it("stores the key in browser localStorage, never in the bundle", () => {
		expect(getApiKey()).toBeNull();
		setApiKey("  abc  ");
		expect(getApiKey()).toBe("abc");
		clearApiKey();
		expect(getApiKey()).toBeNull();
	});

	it("treats an empty key as not entered", () => {
		setApiKey("   ");
		expect(getApiKey()).toBeNull();
	});
});
