import { describe, expect, it } from "vitest";
import { newTemporaryPassword } from "./token";

describe("newTemporaryPassword — FR-29", () => {
	it("FR-29: three groups of 4, letters and digits only between hyphens", () => {
		for (let i = 0; i < 200; i++)
			expect(newTemporaryPassword()).toMatch(
				/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/,
			);
	});

	it("FR-29: always meets the User Pool policy (≥ 12 chars, upper, lower, digit)", () => {
		for (let i = 0; i < 500; i++) {
			const p = newTemporaryPassword();
			expect(p.length).toBeGreaterThanOrEqual(12);
			expect(p).toMatch(/[A-Z]/);
			expect(p).toMatch(/[a-z]/);
			expect(p).toMatch(/\d/);
		}
	});

	it("FR-29: no look-alike characters (I, l, 1, O, 0)", () => {
		for (let i = 0; i < 500; i++)
			expect(newTemporaryPassword()).not.toMatch(/[Il1O0]/);
	});

	it("FR-29: even a worst-case random source (always 0) still has every class", () => {
		const p = newTemporaryPassword(() => 0);
		expect(p).toMatch(/[A-Z]/);
		expect(p).toMatch(/[a-z]/);
		expect(p).toMatch(/\d/);
	});
});
