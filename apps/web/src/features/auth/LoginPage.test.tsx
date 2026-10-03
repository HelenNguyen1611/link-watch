import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Api } from "@/lib/api";
import { type AuthClient, AuthError } from "@/lib/auth";
import { renderWithApi, signedInAuth } from "@/test/render";
import { LoginPage } from "./LoginPage";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const GOOD = "Abcdefghijk1";

function fakeClient(over: Partial<AuthClient> = {}) {
	return {
		currentUser: vi.fn(async () => null),
		getIdToken: vi.fn(async () => null),
		signIn: vi.fn(async () => ({ kind: "signedIn" as const })),
		completeNewPassword: vi.fn(async () => {}),
		requestPasswordReset: vi.fn(async () => {}),
		confirmPasswordReset: vi.fn(async () => {}),
		signOut: vi.fn(async () => {}),
		...over,
	};
}

function renderLogin(
	client = fakeClient(),
	over: Parameters<typeof signedInAuth>[0] = {},
) {
	const refresh = vi.fn(async () => {});
	renderWithApi(
		<LoginPage />,
		{} as Api,
		signedInAuth({ status: "signedOut", user: null, client, refresh, ...over }),
	);
	return { client, refresh };
}

const type = (label: RegExp, value: string) =>
	userEvent.type(screen.getByLabelText(label), value);

beforeEach(() => {
	router.replace.mockReset();
	window.history.replaceState(null, "", "/login/?next=%2Flinks%2F");
});

describe("LoginPage", () => {
	it("FR-28: email + password → signs in and returns to ?next", async () => {
		const { client, refresh } = renderLogin();
		await type(/^Email/, "admin@abc.com");
		await type(/^Password/, "secret");
		await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
		await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/links/"));
		expect(client.signIn).toHaveBeenCalledWith("admin@abc.com", "secret");
		expect(refresh).toHaveBeenCalled();
	});

	it("FR-28: empty form → field errors, Cognito not called", async () => {
		const { client } = renderLogin();
		await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
		expect(await screen.findByText("Enter your email")).toBeTruthy();
		expect(screen.getByText("Enter your password")).toBeTruthy();
		await type(/^Email/, "not-an-email");
		await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
		expect(await screen.findByText("Enter a valid email")).toBeTruthy();
		expect(client.signIn).not.toHaveBeenCalled();
	});

	it("FR-28: wrong password → error message, stays on the page", async () => {
		renderLogin(
			fakeClient({
				signIn: vi.fn(async () => {
					throw new AuthError("invalid_credentials");
				}),
			}),
		);
		await type(/^Email/, "admin@abc.com");
		await type(/^Password/, "wrong");
		await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
		expect((await screen.findByRole("alert")).textContent).toContain(
			"Incorrect email or password.",
		);
		expect(router.replace).not.toHaveBeenCalled();
	});

	it("FR-28: first sign-in with the temporary password → set a new password (policy checked) → signed in", async () => {
		const client = fakeClient({
			signIn: vi.fn(async () => ({ kind: "newPasswordRequired" as const })),
		});
		renderLogin(client);
		await type(/^Email/, "admin@abc.com");
		await type(/^Password/, "Temp-from-email1");
		await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
		expect(
			await screen.findByRole("heading", { name: "Set a new password" }),
		).toBeTruthy();

		await type(/^New password/, "short");
		await type(/^Confirm new password/, "short");
		await userEvent.click(
			screen.getByRole("button", { name: "Save and sign in" }),
		);
		expect(await screen.findByText("Use at least 12 characters")).toBeTruthy();
		expect(client.completeNewPassword).not.toHaveBeenCalled();

		await userEvent.clear(screen.getByLabelText(/^New password/));
		await userEvent.clear(screen.getByLabelText(/^Confirm new password/));
		await type(/^New password/, GOOD);
		await type(/^Confirm new password/, GOOD);
		// Every rule of the checklist is met.
		const rules = document.querySelectorAll("[data-password-rules] [data-met]");
		expect([...rules].map((r) => r.getAttribute("data-met"))).toEqual([
			"true",
			"true",
			"true",
			"true",
		]);
		await userEvent.click(
			screen.getByRole("button", { name: "Save and sign in" }),
		);
		await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/links/"));
		expect(client.completeNewPassword).toHaveBeenCalledWith(GOOD);
	});

	it("FR-28: forgot password → code by email → new password → back to sign in with the email filled in", async () => {
		const { client } = renderLogin();
		await type(/^Email/, "admin@abc.com");
		await userEvent.click(
			screen.getByRole("button", { name: "Forgot password?" }),
		);
		expect(
			await screen.findByRole("heading", { name: "Reset your password" }),
		).toBeTruthy();
		expect((screen.getByLabelText(/^Email/) as HTMLInputElement).value).toBe(
			"admin@abc.com",
		);
		await userEvent.click(screen.getByRole("button", { name: "Send code" }));
		expect(
			await screen.findByRole("heading", { name: "Enter the code" }),
		).toBeTruthy();
		expect(client.requestPasswordReset).toHaveBeenCalledWith("admin@abc.com");
		expect(screen.getByText(/Code sent/)).toBeTruthy();

		await type(/^Verification code/, "123456");
		await type(/^New password/, GOOD);
		await type(/^Confirm new password/, `${GOOD}x`);
		await userEvent.click(
			screen.getByRole("button", { name: "Reset password" }),
		);
		expect(await screen.findByText("The passwords do not match")).toBeTruthy();
		expect(client.confirmPasswordReset).not.toHaveBeenCalled();

		await userEvent.clear(screen.getByLabelText(/^Confirm new password/));
		await type(/^Confirm new password/, GOOD);
		await userEvent.click(
			screen.getByRole("button", { name: "Reset password" }),
		);
		expect(
			await screen.findByRole("heading", { name: "Sign in" }),
		).toBeTruthy();
		expect(client.confirmPasswordReset).toHaveBeenCalledWith(
			"admin@abc.com",
			"123456",
			GOOD,
		);
		expect(screen.getByText(/Password changed/)).toBeTruthy();
		expect((screen.getByLabelText(/^Email/) as HTMLInputElement).value).toBe(
			"admin@abc.com",
		);
	});

	it("FR-28: wrong or expired code → translated error, can ask for a new code", async () => {
		const client = fakeClient({
			confirmPasswordReset: vi.fn(async () => {
				throw new AuthError("code_expired");
			}),
		});
		renderLogin(client);
		await type(/^Email/, "admin@abc.com");
		await userEvent.click(
			screen.getByRole("button", { name: "Forgot password?" }),
		);
		await userEvent.click(
			await screen.findByRole("button", { name: "Send code" }),
		);
		await type(/^Verification code/, "111111");
		await type(/^New password/, GOOD);
		await type(/^Confirm new password/, GOOD);
		await userEvent.click(
			screen.getByRole("button", { name: "Reset password" }),
		);
		expect((await screen.findByRole("alert")).textContent).toContain(
			"The code has expired",
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Send a new code" }),
		);
		await waitFor(() =>
			expect(client.requestPasswordReset).toHaveBeenCalledTimes(2),
		);
	});

	it("FR-28: already signed in → straight to ?next", async () => {
		renderLogin(fakeClient(), {
			status: "signedIn",
			user: { email: "a@b.com", role: "admin" },
		});
		await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/links/"));
	});

	it("NFR-07: ?next pointing to another site is ignored (goes to /)", async () => {
		window.history.replaceState(
			null,
			"",
			"/login/?next=https%3A%2F%2Fevil.com",
		);
		renderLogin();
		await type(/^Email/, "admin@abc.com");
		await type(/^Password/, "secret");
		await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
		await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
	});

	it("sign-in not configured → error instead of the form", () => {
		renderLogin(fakeClient(), { status: "unconfigured", client: null });
		expect(screen.getByText(/Sign-in is not configured/)).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
	});
});
