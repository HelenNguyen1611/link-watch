import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Api } from "@/lib/api";
import { renderWithApi } from "@/test/render";
import { LinkFilters } from "./LinkFilters";

describe("LinkFilters", () => {
	it("FR-09, FR-17: status chips are ordered by severity, worst first", () => {
		renderWithApi(
			<LinkFilters onChange={vi.fn()} shown={0} total={0} />,
			{} as Api,
		);
		const chips = within(screen.getByRole("group", { name: "Status" }));
		expect(
			chips.getAllByRole("checkbox").map((c) => c.closest("div")?.textContent),
		).toEqual(["Site down", "Dead link", "Suspect", "Slow", "Up", "Pending"]);
	});
});
