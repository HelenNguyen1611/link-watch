import { parseCsv } from "@linkwatch/core";
import { describe, expect, it } from "vitest";
import { importChunks } from "./import-chunks";

describe("importChunks — FR-03", () => {
	it("FR-03: a plain list of 60 URLs → 3 chunks of ≤ 25 lines", () => {
		const text = Array.from({ length: 60 }, (_, i) => `https://a.vn/${i}`).join(
			"\n",
		);
		const chunks = importChunks(text);
		expect(chunks.map((c) => c.split("\n").length)).toEqual([25, 25, 10]);
		expect(chunks[2]?.split("\n")[0]).toBe("https://a.vn/50");
	});

	it("FR-03: a CSV keeps its header in every chunk, quoted fields included", () => {
		const text = `url,name\n${Array.from({ length: 30 }, (_, i) => `https://b.vn/${i},"Name, ${i}"`).join("\n")}`;
		const chunks = importChunks(text);
		expect(chunks).toHaveLength(2);
		const second = parseCsv(chunks[1] as string);
		expect(second[0]).toEqual(["url", "name"]);
		expect(second[1]).toEqual(["https://b.vn/25", "Name, 25"]);
		expect(second).toHaveLength(6);
	});

	it("blank lines are ignored; empty text → nothing", () => {
		expect(importChunks("\n\nhttps://a.vn/\n\n")).toEqual(["https://a.vn/"]);
		expect(importChunks("  \n")).toEqual([]);
	});
});
