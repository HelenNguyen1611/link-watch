import { AppShell } from "@mantine/core";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Api } from "@/lib/api";
import { renderWithApi } from "@/test/render";
import { Sidebar } from "./Sidebar";

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
}: {
	pathname?: string;
	initial?: boolean;
}) {
	const [collapsed, setCollapsed] = useState(initial);
	return (
		<AppShell navbar={{ width: 248, breakpoint: "sm" }}>
			<AppShell.Navbar>
				<Sidebar
					pathname={pathname}
					collapsed={collapsed}
					onToggleCollapsed={() => setCollapsed((c) => !c)}
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
			["API key", "/settings/api-key/"],
		]);
		expect(within(nav).getByText("Settings")).toBeTruthy();
	});

	it("marks the current item (aria-current)", () => {
		render(<Harness pathname="/settings/api-key/" />);
		expect(
			screen
				.getByRole("link", { name: "API key" })
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
});
