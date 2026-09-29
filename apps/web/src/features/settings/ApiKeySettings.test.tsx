import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Api } from "@/lib/api";
import { getApiKey } from "@/lib/api-key";
import { renderWithApi } from "@/test/render";
import { ApiKeySettings, maskKey } from "./ApiKeySettings";

beforeEach(() => localStorage.clear());

describe("ApiKeySettings (temporary)", () => {
	it("shows only the last 4 characters of the key", async () => {
		expect(maskKey("abcdefgh1234")).toBe("••••1234");
		localStorage.setItem("linkwatch.apiKey", "secret-key-WXYZ");
		renderWithApi(<ApiKeySettings />, {} as Api);
		expect(await screen.findByText("••••WXYZ")).toBeTruthy();
		expect(screen.queryByText(/secret-key/)).toBeNull();
	});

	it("Change key: clears the stored key and reopens the key form", async () => {
		localStorage.setItem("linkwatch.apiKey", "k1234");
		const onInvalid = vi.fn();
		window.addEventListener("linkwatch:api-key-invalid", onInvalid);
		renderWithApi(<ApiKeySettings />, {} as Api);
		await userEvent.click(
			await screen.findByRole("button", { name: /Change key/ }),
		);
		expect(getApiKey()).toBeNull();
		expect(onInvalid).toHaveBeenCalled();
		window.removeEventListener("linkwatch:api-key-invalid", onInvalid);
	});
});
