import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Api } from "@/lib/api";
import { renderWithApi, signedInAuth } from "@/test/render";
import { AppLayout, SIDEBAR_STORAGE_KEY } from "./AppLayout";

const nav = vi.hoisted(() => ({ pathname: "/links/", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
	usePathname: () => nav.pathname,
	useRouter: () => ({ replace: nav.replace }),
}));
vi.mock("next/link", () => ({
	default: ({
		href,
		children,
		...rest
	}: AnchorHTMLAttributes<HTMLAnchorElement> & { children: ReactNode }) => (
		<a href={href} {...rest}>
			{children}
		</a>
	),
}));

beforeEach(() => {
	localStorage.clear();
	nav.pathname = "/links/";
	nav.replace.mockReset();
});

describe("AppLayout", () => {
	it("renders the logo, sidebar and page content", async () => {
		renderWithApi(<AppLayout>page content</AppLayout>, {} as Api);
		expect(await screen.findByText("page content")).toBeTruthy();
		expect(screen.getByRole("navigation", { name: "Menu" })).toBeTruthy();
		expect(screen.getAllByText("LinkWatch").length).toBeGreaterThan(0);
	});

	it("remembers the collapsed sidebar in the browser", async () => {
		const { unmount } = renderWithApi(<AppLayout>x</AppLayout>, {} as Api);
		await userEvent.click(
			await screen.findByRole("button", { name: "Collapse" }),
		);
		expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("true");
		unmount();
		renderWithApi(<AppLayout>x</AppLayout>, {} as Api);
		expect(await screen.findByRole("button", { name: "Expand" })).toBeTruthy();
	});

	it("footer is the last element and content fills the viewport so the footer stays at the bottom", async () => {
		renderWithApi(<AppLayout>short</AppLayout>, {} as Api);
		const footer = await screen.findByRole("contentinfo");
		expect(footer.textContent).toContain("watch.hueai.net");
		const shell = footer.parentElement as HTMLElement;
		expect(shell.lastElementChild).toBe(footer);
		expect(shell.style.flexDirection).toBe("column");
		expect(getComputedStyle(shell).minHeight).toContain("100dvh");
		expect((footer.previousElementSibling as HTMLElement).style.flex).toContain(
			"1",
		);
	});

	it("mobile (test viewport is below sm): a collapsed preference still shows menu labels", async () => {
		localStorage.setItem(SIDEBAR_STORAGE_KEY, "true");
		renderWithApi(<AppLayout>x</AppLayout>, {} as Api);
		const menu = await screen.findByRole("navigation", { name: "Menu" });
		expect(menu.textContent).toContain("Overview");
		expect(menu.textContent).toContain("Account");
	});

	it("header: logo on the left, menu (burger) button on the right", async () => {
		renderWithApi(<AppLayout>x</AppLayout>, {} as Api);
		const logo = await screen.findByRole("link", { name: "LinkWatch" });
		const burger = screen.getAllByRole("button", { name: "Menu" })[0];
		expect(
			logo.compareDocumentPosition(burger) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});

	it("FR-28: header shows the signed-in email and Sign out (replacing the tagline)", async () => {
		const signOut = vi.fn(async () => {});
		renderWithApi(
			<AppLayout>x</AppLayout>,
			{} as Api,
			signedInAuth({ signOut }),
		);
		expect(await screen.findByText("admin@abc.com")).toBeTruthy();
		expect(
			screen.queryByText("Monitor dead links and site outages"),
		).toBeNull();
		await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
		expect(signOut).toHaveBeenCalledTimes(1);
	});

	it("FR-28: signed out → goes to /login/ with the current page as next, content hidden", async () => {
		renderWithApi(
			<AppLayout>secret</AppLayout>,
			{} as Api,
			signedInAuth({ status: "signedOut", user: null }),
		);
		await waitFor(() =>
			expect(nav.replace).toHaveBeenCalledWith("/login/?next=%2Flinks%2F"),
		);
		expect(screen.queryByText("secret")).toBeNull();
	});

	it("FR-28: while the session is being checked nothing of the page is shown", async () => {
		renderWithApi(
			<AppLayout>secret</AppLayout>,
			{} as Api,
			signedInAuth({ status: "loading", user: null }),
		);
		expect(
			screen.getByRole("status", { name: "Checking your session" }),
		).toBeTruthy();
		expect(screen.queryByText("secret")).toBeNull();
		expect(nav.replace).not.toHaveBeenCalled();
	});

	it("FR-28: production without /auth-config.json → error, never the page", async () => {
		renderWithApi(
			<AppLayout>secret</AppLayout>,
			{} as Api,
			signedInAuth({ status: "unconfigured", user: null }),
		);
		expect(await screen.findByText(/Sign-in is not configured/)).toBeTruthy();
		expect(screen.queryByText("secret")).toBeNull();
	});

	it("public pages (/login/, /confirm/) render without the shell and without signing in", async () => {
		for (const path of ["/login/", "/confirm/"]) {
			nav.pathname = path;
			const { unmount } = renderWithApi(
				<AppLayout>public page</AppLayout>,
				{} as Api,
				signedInAuth({ status: "signedOut", user: null }),
			);
			expect(screen.getByText("public page")).toBeTruthy();
			expect(screen.queryByRole("navigation", { name: "Menu" })).toBeNull();
			unmount();
		}
		expect(nav.replace).not.toHaveBeenCalled();
	});
});
