import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Api } from "@/lib/api";
import { getApiKey } from "@/lib/api-key";
import { renderWithApi } from "@/test/render";
import { ApiKeySettings, maskKey } from "./ApiKeySettings";

beforeEach(() => localStorage.clear());

describe("ApiKeySettings (tạm thời)", () => {
	it("chỉ hiện 4 ký tự cuối của khóa", async () => {
		expect(maskKey("abcdefgh1234")).toBe("••••1234");
		localStorage.setItem("linkwatch.apiKey", "khoa-bi-mat-WXYZ");
		renderWithApi(<ApiKeySettings />, {} as Api);
		expect(await screen.findByText("••••WXYZ")).toBeTruthy();
		expect(screen.queryByText(/khoa-bi-mat/)).toBeNull();
	});

	it("Đổi khóa: xóa khóa đã lưu và mở lại ô nhập khóa", async () => {
		localStorage.setItem("linkwatch.apiKey", "k1234");
		const onInvalid = vi.fn();
		window.addEventListener("linkwatch:api-key-invalid", onInvalid);
		renderWithApi(<ApiKeySettings />, {} as Api);
		await userEvent.click(
			await screen.findByRole("button", { name: /Đổi khóa/ }),
		);
		expect(getApiKey()).toBeNull();
		expect(onInvalid).toHaveBeenCalled();
		window.removeEventListener("linkwatch:api-key-invalid", onInvalid);
	});
});
