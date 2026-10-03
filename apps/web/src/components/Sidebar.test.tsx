import { AppShell } from "@mantine/core";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Api } from "@/lib/api";
import { renderWithApi, signedInAuth } from "@/test/render";
import {
	fluidWidth,
	SHELL_GUTTER,
	SIDEBAR_FLUID_WIDTH,
	Sidebar,
} from "./Sidebar";

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

function Harness({
	pathname = "/links/",
	initial = false,
	mobile = false,
}: {
	pathname?: string;
	initial?: boolean;
	mobile?: boolean;
}) {
	const [collapsed, setCollapsed] = useState(initial);
	return (
		<AppShell navbar={{ width: 248, breakpoint: "sm" }}>
			<AppShell.Navbar>
				<Sidebar
					pathname={pathname}
					collapsed={collapsed}
					onToggleCollapsed={() => setCollapsed((c) => !c)}
					mobile={mobile}
				/>
			</AppShell.Navbar>
		</AppShell>
	);
}

const render = (ui: React.ReactElement) => renderWithApi(ui, {} as Api);

describe("Sidebar", () => {
	it("lists the main menu and the Settings group with the right links", () => {
		render(<Harness />);
		const nav = screen.getByRole("navigation", { name: "Menu" });
		const links = within(nav).getAllByRole("link");
		expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
			["Overview", "/"],
			["Domains", "/domains/"],
			["Links", "/links/"],
			["Schedules", "/schedules/"],
			["Incidents", "/incidents/"],
			["Alert email", "/settings/email/"],
			["Account", "/settings/account/"],
			["Users", "/settings/users/"],
		]);
		expect(within(nav).getByText("Settings")).toBeTruthy();
	});

	it("FR-29: the Users item is shown to admins only", () => {
		renderWithApi(
			<Harness />,
			{} as Api,
			signedInAuth({ user: { email: "e@abc.com", role: "editor" } }),
		);
		expect(screen.queryByRole("link", { name: "Users" })).toBeNull();
		expect(screen.getByRole("link", { name: "Account" })).toBeTruthy();
	});

	it("marks the current item (aria-current)", () => {
		render(<Harness pathname="/settings/account/" />);
		expect(
			screen
				.getByRole("link", { name: "Account" })
				.getAttribute("aria-current"),
		).toBe("page");
		expect(
			screen.getByRole("link", { name: "Links" }).getAttribute("aria-current"),
		).toBeNull();
	});

	it("collapsed: icons only, labels kept via aria-label; click again to expand", async () => {
		render(<Harness />);
		await userEvent.click(screen.getByRole("button", { name: "Collapse" }));
		expect(screen.queryByText("Overview")).toBeNull();
		const overview = screen.getByRole("link", { name: "Overview" });
		expect(overview.textContent).toBe("");
		const toggle = screen.getByRole("button", { name: "Expand" });
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		await userEvent.click(toggle);
		expect(screen.getByText("Overview")).toBeTruthy();
	});

	it("mobile: the drawer always shows labels, even when collapsed on desktop", () => {
		render(<Harness initial mobile />);
		for (const label of ["Overview", "Links", "Settings", "Account"]) {
			expect(screen.getByText(label)).toBeTruthy();
		}
	});

	it("collapsed: every item is a centred icon of the same size, including the Settings icon", async () => {
		render(<Harness />);
		await userEvent.click(screen.getByRole("button", { name: "Collapse" }));
		const nav = screen.getByRole("navigation", { name: "Menu" });
		const links = within(nav).getAllByRole("link");
		// 5 main items + Alert email, Account and Users (signed in as admin).
		expect(links).toHaveLength(8);
		for (const a of links) {
			expect(a.style.justifyContent).toBe("center");
			expect(a.querySelector("svg")?.getAttribute("width")).toBe("20");
		}
		const svgs = [...nav.querySelectorAll("svg")].map((svg) =>
			svg.getAttribute("width"),
		);
		expect(new Set(svgs)).toEqual(new Set(["20"]));
	});

	it("expanded width shrinks with the screen: 180 px at the sm breakpoint (768), 248 px from 1440", () => {
		expect(SIDEBAR_FLUID_WIDTH).toBe(
			"clamp(180px, 102.29px + 10.119vw, 248px)",
		);
		// The linear part hits both ends (within rounding).
		const at = (vw: number) => 102.29 + (10.119 * vw) / 100;
		expect(at(768)).toBeCloseTo(180, 0);
		expect(at(1440)).toBeCloseTo(248, 0);
		expect(at(1100)).toBeGreaterThan(180);
		expect(at(1100)).toBeLessThan(248);
		expect(fluidWidth(100, 200, 1000, 2000)).toBe(
			"clamp(100px, 0px + 10vw, 200px)",
		);
	});

	it("menu items use the same left inset as the header logo", () => {
		render(<Harness />);
		const item = screen.getByRole("link", { name: "Overview" });
		expect(item.getAttribute("style")).toContain(
			`--mantine-spacing-${SHELL_GUTTER}`,
		);
	});

	it("the active marker does not shift content (inset shadow, no border)", () => {
		render(<Harness pathname="/links/" />);
		const active = screen.getByRole("link", { name: "Links" });
		expect(active.style.boxShadow).toContain("inset 2px 0 0");
		expect(active.style.borderLeft).toBe("");
	});
});
