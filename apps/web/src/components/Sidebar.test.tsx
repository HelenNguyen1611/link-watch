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
	it("có đủ menu chính và nhóm Cài đặt, đúng đường dẫn", () => {
		render(<Harness />);
		const nav = screen.getByRole("navigation", { name: "Menu" });
		const links = within(nav).getAllByRole("link");
		expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
			["Tổng quan", "/"],
			["Domain", "/domains/"],
			["Link", "/links/"],
			["Lịch", "/schedules/"],
			["Sự cố", "/incidents/"],
			["Email cảnh báo", "/settings/email/"],
			["Tài khoản", "/settings/account/"],
			["Khóa API", "/settings/api-key/"],
		]);
		expect(within(nav).getByText("Cài đặt")).toBeTruthy();
	});

	it("đánh dấu mục đang mở (aria-current)", () => {
		render(<Harness pathname="/settings/api-key/" />);
		expect(
			screen
				.getByRole("link", { name: "Khóa API" })
				.getAttribute("aria-current"),
		).toBe("page");
		expect(
			screen.getByRole("link", { name: "Link" }).getAttribute("aria-current"),
		).toBeNull();
	});

	it("thu gọn: chỉ còn icon, tên mục vẫn có qua aria-label; bấm lần nữa để mở rộng", async () => {
		render(<Harness />);
		await userEvent.click(screen.getByRole("button", { name: "Thu gọn" }));
		expect(screen.queryByText("Tổng quan")).toBeNull();
		const overview = screen.getByRole("link", { name: "Tổng quan" });
		expect(overview.textContent).toBe("");
		const toggle = screen.getByRole("button", { name: "Mở rộng" });
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		await userEvent.click(toggle);
		expect(screen.getByText("Tổng quan")).toBeTruthy();
	});
});
