import type { SettingsInput, SettingsView } from "@linkwatch/core";
import { notifications } from "@mantine/notifications";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { type Api, ApiError } from "@/lib/api";
import { renderWithApi, signedInAuth } from "@/test/render";
import { EmailSettingsPage } from "./EmailSettingsPage";

const DEFAULTS: SettingsView = {
	senderEmail: "noreply@watch.hueai.net",
	senderName: "LinkWatch",
	defaultAdminEmail: "helen@wootech.co",
	remindersEnabled: true,
	reminderIntervalHours: 24,
	sesIdentity: "watch.hueai.net",
};

/** Fake API mirroring the settings routes (PATCH merges; the sender must be on the identity). */
function fakeApi(initial: SettingsView = DEFAULTS) {
	let settings = { ...initial };
	const api = {
		listLinks: vi.fn(),
		createLink: vi.fn(),
		deleteLink: vi.fn(),
		getSettings: vi.fn(async () => settings),
		updateSettings: vi.fn(async (input: SettingsInput) => {
			settings = { ...settings, ...input };
			return settings;
		}),
		sendTestEmail: vi.fn(async (to?: string) => ({
			status: "sent" as const,
			to: to ?? "admin@abc.com",
		})),
	} satisfies Api;
	return api;
}

const field = (name: string) =>
	screen.findByRole("textbox", { name: new RegExp(`^${name}`) });

describe("EmailSettingsPage — SCR-08", () => {
	it("FR-20, FR-23, FR-26: shows the effective settings", async () => {
		renderWithApi(<EmailSettingsPage />, fakeApi());
		expect(((await field("Sender address")) as HTMLInputElement).value).toBe(
			"noreply@watch.hueai.net",
		);
		expect(((await field("Sender name")) as HTMLInputElement).value).toBe(
			"LinkWatch",
		);
		expect(((await field("Admin email")) as HTMLInputElement).value).toBe(
			"helen@wootech.co",
		);
		expect(
			(
				screen.getByRole("switch", {
					name: "Send reminders",
				}) as HTMLInputElement
			).checked,
		).toBe(true);
		expect(
			(
				screen.getByRole("textbox", {
					name: "Remind every",
				}) as HTMLInputElement
			).value,
		).toBe("24 hours");
		expect(
			screen.getByText(/must belong to the verified domain watch\.hueai\.net/),
		).toBeTruthy();
	});

	it("Save is disabled until something changes", async () => {
		renderWithApi(<EmailSettingsPage />, fakeApi());
		await field("Sender name");
		expect(
			(
				screen.getByRole("button", {
					name: "Save changes",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});

	it("FR-20 / FR-26: saves every field through the API and confirms", async () => {
		const show = vi.spyOn(notifications, "show");
		const api = fakeApi();
		renderWithApi(<EmailSettingsPage />, api);
		const name = await field("Sender name");
		await userEvent.clear(name);
		await userEvent.type(name, "Ops Alerts");
		const admin = await field("Admin email");
		await userEvent.clear(admin);
		await userEvent.type(admin, " Ops@ABC.com ");
		await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
		await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(1));
		expect(api.updateSettings.mock.calls[0]?.[0]).toEqual({
			senderEmail: "noreply@watch.hueai.net",
			senderName: "Ops Alerts",
			defaultAdminEmail: "ops@abc.com",
			remindersEnabled: true,
			reminderIntervalHours: 24,
		});
		await waitFor(() =>
			expect(show).toHaveBeenCalledWith(
				expect.objectContaining({ message: "Email settings saved." }),
			),
		);
		// The saved values are the new baseline.
		await waitFor(() =>
			expect(
				(
					screen.getByRole("button", {
						name: "Save changes",
					}) as HTMLButtonElement
				).disabled,
			).toBe(true),
		);
	});

	it("FR-26: a sender outside the verified SES domain is rejected before calling the API", async () => {
		const api = fakeApi();
		renderWithApi(<EmailSettingsPage />, api);
		const sender = await field("Sender address");
		await userEvent.clear(sender);
		await userEvent.type(sender, "alerts@gmail.com");
		await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
		expect(
			await screen.findByText("Must be an address of watch.hueai.net"),
		).toBeTruthy();
		expect(api.updateSettings).not.toHaveBeenCalled();
	});

	it("invalid admin email → field error, API not called", async () => {
		const api = fakeApi();
		renderWithApi(<EmailSettingsPage />, api);
		const admin = await field("Admin email");
		await userEvent.clear(admin);
		await userEvent.type(admin, "not-an-email");
		await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
		expect(await screen.findByText("Enter a valid email address")).toBeTruthy();
		expect(api.updateSettings).not.toHaveBeenCalled();
	});

	it("FR-23: turning reminders off disables the interval and saves remindersEnabled = false", async () => {
		const api = fakeApi();
		renderWithApi(<EmailSettingsPage />, api);
		await field("Sender name");
		await userEvent.click(
			screen.getByRole("switch", { name: "Send reminders" }),
		);
		expect(
			(
				screen.getByRole("textbox", {
					name: "Remind every",
				}) as HTMLInputElement
			).disabled,
		).toBe(true);
		await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
		await waitFor(() =>
			expect(api.updateSettings.mock.calls[0]?.[0]).toMatchObject({
				remindersEnabled: false,
			}),
		);
	});

	it("FR-23: an interval outside 1–720 hours is rejected", async () => {
		const api = fakeApi();
		renderWithApi(<EmailSettingsPage />, api);
		const interval = await screen.findByRole("textbox", {
			name: "Remind every",
		});
		await userEvent.clear(interval);
		await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
		expect(
			await screen.findByText(
				"Enter a whole number of hours between 1 and 720",
			),
		).toBeTruthy();
		expect(api.updateSettings).not.toHaveBeenCalled();
	});

	it("FR-26: API refusing the sender (sender_not_verified) → error under the sender field", async () => {
		const api = fakeApi();
		api.updateSettings.mockRejectedValueOnce(
			new ApiError(400, { error: "sender_not_verified" }),
		);
		renderWithApi(<EmailSettingsPage />, api);
		const name = await field("Sender name");
		await userEvent.type(name, "!");
		await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
		expect(
			await screen.findByText("Must be an address of watch.hueai.net"),
		).toBeTruthy();
	});

	it("Discard restores the loaded values", async () => {
		renderWithApi(<EmailSettingsPage />, fakeApi());
		const name = await field("Sender name");
		await userEvent.type(name, " changed");
		await userEvent.click(screen.getByRole("button", { name: "Discard" }));
		expect((name as HTMLInputElement).value).toBe("LinkWatch");
	});

	it("load error → error box", async () => {
		const api = fakeApi();
		api.getSettings.mockRejectedValue(new ApiError(500, { error: "internal" }));
		renderWithApi(<EmailSettingsPage />, api);
		expect(
			await screen.findByText("Could not load the email settings."),
		).toBeTruthy();
	});
});

describe("EmailSettingsPage — test email (FR-26)", () => {
	it("FR-26: empty recipient → sent to the signed-in user", async () => {
		const api = fakeApi();
		renderWithApi(
			<EmailSettingsPage />,
			api,
			signedInAuth({ user: { email: "helen@wootech.co" } }),
		);
		const to = await field("Send to");
		expect((to as HTMLInputElement).placeholder).toBe("helen@wootech.co");
		await userEvent.click(
			screen.getByRole("button", { name: "Send test email" }),
		);
		await waitFor(() =>
			expect(api.sendTestEmail).toHaveBeenCalledWith(undefined),
		);
		expect(
			await screen.findByText("Test email sent to admin@abc.com."),
		).toBeTruthy();
	});

	it("FR-26: sends to the address typed in", async () => {
		const api = fakeApi();
		renderWithApi(<EmailSettingsPage />, api);
		await userEvent.type(await field("Send to"), "ops@abc.com");
		await userEvent.click(
			screen.getByRole("button", { name: "Send test email" }),
		);
		await waitFor(() =>
			expect(api.sendTestEmail).toHaveBeenCalledWith("ops@abc.com"),
		);
		expect(
			await screen.findByText("Test email sent to ops@abc.com."),
		).toBeTruthy();
	});

	it("invalid recipient → field error, nothing sent", async () => {
		const api = fakeApi();
		renderWithApi(<EmailSettingsPage />, api);
		await userEvent.type(await field("Send to"), "nope");
		await userEvent.click(
			screen.getByRole("button", { name: "Send test email" }),
		);
		expect(await screen.findByText("Enter a valid email address")).toBeTruthy();
		expect(api.sendTestEmail).not.toHaveBeenCalled();
	});

	it("FR-26: SES failure (e.g. sandbox, unverified recipient) → shows the SES error and the sandbox hint", async () => {
		const api = fakeApi();
		api.sendTestEmail.mockRejectedValue(
			new ApiError(502, {
				status: "failed",
				to: "x@abc.com",
				error: "MessageRejected: Email address is not verified.",
			}),
		);
		renderWithApi(<EmailSettingsPage />, api);
		await userEvent.type(await field("Send to"), "x@abc.com");
		await userEvent.click(
			screen.getByRole("button", { name: "Send test email" }),
		);
		expect(
			await screen.findByText("The test email could not be sent."),
		).toBeTruthy();
		expect(
			screen.getByText("MessageRejected: Email address is not verified."),
		).toBeTruthy();
		expect(screen.getByText(/only verified addresses/)).toBeTruthy();
	});
});
