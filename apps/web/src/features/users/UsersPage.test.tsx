import type { UserInvite, UserView } from "@linkwatch/core";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { type Api, ApiError } from "@/lib/api";
import { renderWithApi, signedInAuth } from "@/test/render";
import { stubApi } from "@/test/stub-api";
import { UsersPage } from "./UsersPage";

const users: UserView[] = [
	{
		email: "admin@abc.com",
		role: "admin",
		status: "active",
		enabled: true,
		createdAt: "2026-09-30T00:00:00.000Z",
	},
	{ email: "ops@abc.com", role: "editor", status: "active", enabled: true },
	{ email: "new@abc.com", role: "viewer", status: "invited", enabled: true },
];

function fakeApi() {
	return {
		...stubApi(),
		listUsers: vi.fn(async () => ({ items: users })),
		inviteUser: vi.fn(
			async (input: UserInvite): Promise<UserView> => ({
				...input,
				status: "invited",
				enabled: true,
			}),
		),
		updateUser: vi.fn(async (email: string, input: Partial<UserView>) => ({
			...(users.find((u) => u.email === email) as UserView),
			...input,
		})),
		resendInvite: vi.fn(async (email: string) => ({
			status: "sent" as const,
			to: email,
		})),
		deleteUser: vi.fn(async () => undefined),
	} satisfies Api;
}

const row = async (email: string) =>
	within((await screen.findByText(email)).closest("tr") as HTMLElement);

describe("UsersPage — SCR-09, FR-29", () => {
	it("FR-29: lists users with role and status; the admin's own row cannot be changed", async () => {
		renderWithApi(<UsersPage />, fakeApi());
		const me = await row("admin@abc.com");
		expect(me.getByText("You")).toBeTruthy();
		expect(me.queryByRole("button", { name: /Delete/ })).toBeNull();
		expect(me.queryByRole("button", { name: /Disable/ })).toBeNull();
		const invited = await row("new@abc.com");
		expect(invited.getByText("Invited")).toBeTruthy();
		expect(
			invited.getByRole("button", { name: "Resend invite new@abc.com" }),
		).toBeTruthy();
		expect(
			(await row("ops@abc.com")).queryByRole("button", { name: /Resend/ }),
		).toBeNull();
	});

	it("FR-29: invites a user with a role", async () => {
		const api = fakeApi();
		renderWithApi(<UsersPage />, api);
		await userEvent.click(
			await screen.findByRole("button", { name: "Invite user" }),
		);
		await userEvent.type(screen.getByLabelText(/Email/), "Someone@ABC.com");
		await userEvent.click(
			within(screen.getByRole("dialog")).getAllByLabelText(
				/^Role/,
			)[0] as HTMLElement,
		);
		await userEvent.click(screen.getByRole("option", { name: "Editor" }));
		await userEvent.click(screen.getByRole("button", { name: "Send invite" }));
		await waitFor(() =>
			expect(api.inviteUser).toHaveBeenCalledWith({
				email: "someone@abc.com",
				role: "editor",
			}),
		);
	});

	it("FR-29: an existing account shows the duplicate error in the dialog", async () => {
		const api = {
			...fakeApi(),
			inviteUser: vi.fn(async () => {
				throw new ApiError(409, { error: "duplicate" });
			}),
		};
		renderWithApi(<UsersPage />, api);
		await userEvent.click(
			await screen.findByRole("button", { name: "Invite user" }),
		);
		await userEvent.type(screen.getByLabelText(/Email/), "ops@abc.com");
		await userEvent.click(screen.getByRole("button", { name: "Send invite" }));
		expect(
			await screen.findByText("This email already has an account."),
		).toBeTruthy();
	});

	it("FR-29: changes a role, disables and deletes (with confirmation)", async () => {
		const api = fakeApi();
		renderWithApi(<UsersPage />, api);
		const ops = await row("ops@abc.com");
		await userEvent.click(
			ops.getAllByLabelText("Role ops@abc.com")[0] as HTMLElement,
		);
		await userEvent.click(screen.getByRole("option", { name: "Viewer" }));
		await waitFor(() =>
			expect(api.updateUser).toHaveBeenCalledWith("ops@abc.com", {
				role: "viewer",
			}),
		);
		await userEvent.click(
			ops.getByRole("button", { name: "Disable ops@abc.com" }),
		);
		await waitFor(() =>
			expect(api.updateUser).toHaveBeenCalledWith("ops@abc.com", {
				enabled: false,
			}),
		);
		await userEvent.click(
			ops.getByRole("button", { name: "Delete ops@abc.com" }),
		);
		expect(api.deleteUser).not.toHaveBeenCalled();
		await userEvent.click(
			ops.getByRole("button", { name: "Confirm delete ops@abc.com" }),
		);
		await waitFor(() => expect(api.deleteUser).toHaveBeenCalledTimes(1));
	});

	it("HLR-09: a non-admin sees a notice and the API is not called", () => {
		const api = fakeApi();
		renderWithApi(
			<UsersPage />,
			api,
			signedInAuth({ user: { email: "ops@abc.com", role: "editor" } }),
		);
		expect(screen.getByText("Only admins can manage users.")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Invite user" })).toBeNull();
		expect(api.listUsers).not.toHaveBeenCalled();
	});
});
