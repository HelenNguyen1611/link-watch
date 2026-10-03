import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithApi, signedInAuth } from "@/test/render";
import { stubApi } from "@/test/stub-api";
import { AccountPage } from "./AccountPage";

describe("AccountPage — SCR-09 (FR-28)", () => {
	it("FR-28: shows the signed-in email and signs out", async () => {
		const signOut = vi.fn(async () => {});
		renderWithApi(<AccountPage />, stubApi(), signedInAuth({ signOut }));
		expect(screen.getByTestId("account-email").textContent).toBe(
			"admin@abc.com",
		);
		await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
		expect(signOut).toHaveBeenCalledTimes(1);
	});

	it("HLR-09: shows the role from the session", () => {
		renderWithApi(
			<AccountPage />,
			stubApi(),
			signedInAuth({ user: { email: "v@abc.com", role: "viewer" } }),
		);
		expect(screen.getByTestId("account-role").textContent).toMatch(/^Viewer/);
	});
});
