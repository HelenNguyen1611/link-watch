import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Api } from "@/lib/api";
import { renderWithApi } from "@/test/render";
import { AppLayout, SIDEBAR_STORAGE_KEY } from "./AppLayout";

vi.mock("next/navigation", () => ({ usePathname: () => "/links/" }));
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
	localStorage.setItem("linkwatch.apiKey", "k");
});

describe("AppLayout", () => {
	it("có logo, sidebar và nội dung trang", async () => {
		renderWithApi(<AppLayout>nội dung</AppLayout>, {} as Api);
		expect(await screen.findByText("nội dung")).toBeTruthy();
		expect(screen.getByRole("navigation", { name: "Menu" })).toBeTruthy();
		expect(screen.getAllByText("LinkWatch").length).toBeGreaterThan(0);
	});

	it("nhớ trạng thái thu gọn sidebar trên trình duyệt", async () => {
		const { unmount } = renderWithApi(<AppLayout>x</AppLayout>, {} as Api);
		await userEvent.click(
			await screen.findByRole("button", { name: "Thu gọn" }),
		);
		expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("true");
		unmount();
		renderWithApi(<AppLayout>x</AppLayout>, {} as Api);
		expect(await screen.findByRole("button", { name: "Mở rộng" })).toBeTruthy();
	});
});
