import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useApi } from "./api-context";
import { type AuthClient, notifyUnauthorized } from "./auth";
import { AuthProvider, useAuth } from "./auth-context";

function fakeClient(email: string | null): AuthClient & {
	signOut: ReturnType<typeof vi.fn>;
} {
	let current = email;
	return {
		currentUser: vi.fn(async () =>
			current ? { email: current, role: "admin" as const } : null,
		),
		getIdToken: vi.fn(async () => (current ? "id-token-1" : null)),
		signIn: vi.fn(),
		completeNewPassword: vi.fn(),
		requestPasswordReset: vi.fn(),
		confirmPasswordReset: vi.fn(),
		signOut: vi.fn(async () => {
			current = null;
		}),
	};
}

function Probe() {
	const { status, user } = useAuth();
	const api = useApi();
	return (
		<>
			<span data-testid="status">{status}</span>
			<span data-testid="user">{user?.email ?? "-"}</span>
			<button type="button" onClick={() => api.listLinks().catch(() => {})}>
				load
			</button>
		</>
	);
}

afterEach(() => vi.unstubAllGlobals());

describe("AuthProvider", () => {
	it("FR-28: existing session → signedIn with the user's email", async () => {
		const client = fakeClient("a@b.com");
		render(
			<AuthProvider loadClient={async () => client}>
				<Probe />
			</AuthProvider>,
		);
		expect(screen.getByTestId("status").textContent).toBe("loading");
		await waitFor(() =>
			expect(screen.getByTestId("status").textContent).toBe("signedIn"),
		);
		expect(screen.getByTestId("user").textContent).toBe("a@b.com");
	});

	it("no session → signedOut; no config → unconfigured", async () => {
		const { unmount } = render(
			<AuthProvider loadClient={async () => fakeClient(null)}>
				<Probe />
			</AuthProvider>,
		);
		await waitFor(() =>
			expect(screen.getByTestId("status").textContent).toBe("signedOut"),
		);
		unmount();
		render(
			<AuthProvider loadClient={async () => null}>
				<Probe />
			</AuthProvider>,
		);
		await waitFor(() =>
			expect(screen.getByTestId("status").textContent).toBe("unconfigured"),
		);
	});

	it("FR-28: the provided API client sends the ID token as Bearer", async () => {
		const fetch = vi.fn(
			async (_url: string, _init?: RequestInit) =>
				new Response(JSON.stringify({ items: [], cursor: null })),
		);
		vi.stubGlobal("fetch", fetch);
		render(
			<AuthProvider loadClient={async () => fakeClient("a@b.com")}>
				<Probe />
			</AuthProvider>,
		);
		await waitFor(() =>
			expect(screen.getByTestId("status").textContent).toBe("signedIn"),
		);
		await act(async () => screen.getByRole("button", { name: "load" }).click());
		await waitFor(() => expect(fetch).toHaveBeenCalled());
		const init = fetch.mock.calls[0]?.[1];
		expect(new Headers(init?.headers).get("authorization")).toBe(
			"Bearer id-token-1",
		);
	});

	it("FR-28: a 401 from the API signs out (session expired or revoked)", async () => {
		const client = fakeClient("a@b.com");
		render(
			<AuthProvider loadClient={async () => client}>
				<Probe />
			</AuthProvider>,
		);
		await waitFor(() =>
			expect(screen.getByTestId("status").textContent).toBe("signedIn"),
		);
		act(() => notifyUnauthorized());
		await waitFor(() =>
			expect(screen.getByTestId("status").textContent).toBe("signedOut"),
		);
		expect(client.signOut).toHaveBeenCalledTimes(1);
		expect(screen.getByTestId("user").textContent).toBe("-");
	});
});
