import type { ScheduleView } from "@linkwatch/core";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { type Api, ApiError } from "@/lib/api";
import { renderWithApi } from "@/test/render";
import { stubApi } from "@/test/stub-api";
import { SchedulesPage } from "./SchedulesPage";

const schedules: ScheduleView[] = [
	{
		id: "default",
		name: "Default",
		rule: { kind: "daily", at: "06:00" },
		usedBy: { domains: 0, links: 0 },
	},
	{
		id: "S1",
		name: "Quarter-hourly",
		rule: { kind: "interval", minutes: 15 },
		usedBy: { domains: 2, links: 1 },
	},
];

function fakeApi() {
	const api = {
		...stubApi(),
		listSchedules: vi.fn(async () => ({ items: schedules })),
		createSchedule: vi.fn(
			async (input: { name: string; rule: ScheduleView["rule"] }) => ({
				id: "NEW",
				...input,
			}),
		),
		updateSchedule: vi.fn(async (id: string, input: Partial<ScheduleView>) => ({
			...(schedules.find((s) => s.id === id) as ScheduleView),
			...input,
		})),
		deleteSchedule: vi.fn(async () => undefined),
	} satisfies Api;
	return api;
}

describe("SchedulesPage — SCR-06", () => {
	it("FR-11 / FR-12: lists the default schedule first, rules in words and usage", async () => {
		renderWithApi(<SchedulesPage />, fakeApi());
		expect(await screen.findByText("System default")).toBeTruthy();
		expect(screen.getByText("Daily at 06:00")).toBeTruthy();
		const row = within(
			screen.getByText("Quarter-hourly").closest("tr") as HTMLElement,
		);
		expect(row.getByText("Every 15 minutes")).toBeTruthy();
		expect(row.getByText("2 domains · 1 links")).toBeTruthy();
		// The default schedule cannot be deleted.
		const def = within(
			screen.getByText("System default").closest("tr") as HTMLElement,
		);
		expect(def.queryByRole("button", { name: /Delete/ })).toBeNull();
	});

	it("FR-12: create a weekly schedule on Mon and Fri at 07:30", async () => {
		const api = fakeApi();
		renderWithApi(<SchedulesPage />, api);
		await userEvent.click(
			await screen.findByRole("button", { name: "New schedule" }),
		);
		const dialog = within(await screen.findByRole("dialog"));
		await userEvent.type(
			dialog.getByRole("textbox", { name: "Name" }),
			"Mon & Fri",
		);
		await userEvent.click(dialog.getByText("Weekly"));
		fireEvent.change(dialog.getByLabelText("At (Vietnam time)"), {
			target: { value: "07:30" },
		});
		await userEvent.click(
			within(dialog.getByRole("group", { name: "Weekdays" })).getByText("Fri"),
		);
		await userEvent.click(dialog.getByRole("button", { name: "Save" }));
		await waitFor(() =>
			expect(api.createSchedule).toHaveBeenCalledWith({
				name: "Mon & Fri",
				rule: { kind: "weekly", days: [1, 5], at: "07:30" },
			}),
		);
	});

	it("FR-12: no weekday chosen and no name → errors, nothing sent", async () => {
		const api = fakeApi();
		renderWithApi(<SchedulesPage />, api);
		await userEvent.click(
			await screen.findByRole("button", { name: "New schedule" }),
		);
		const dialog = within(await screen.findByRole("dialog"));
		await userEvent.click(dialog.getByText("Weekly"));
		await userEvent.click(
			within(dialog.getByRole("group", { name: "Weekdays" })).getByText("Mon"),
		);
		await userEvent.click(dialog.getByRole("button", { name: "Save" }));
		expect(
			await dialog.findByText("Enter a name (up to 100 characters)"),
		).toBeTruthy();
		expect(dialog.getByText("Choose at least one day")).toBeTruthy();
		expect(api.createSchedule).not.toHaveBeenCalled();
	});

	it("FR-11: edit the default schedule to every 30 minutes", async () => {
		const api = fakeApi();
		renderWithApi(<SchedulesPage />, api);
		await userEvent.click(
			await screen.findByRole("button", { name: "Edit System default" }),
		);
		const dialog = within(await screen.findByRole("dialog"));
		await userEvent.click(dialog.getByText("Every…"));
		// Mantine Select also renders a hidden input with the same label.
		await userEvent.click(
			dialog.getAllByLabelText("Check every")[0] as HTMLElement,
		);
		await userEvent.click(
			await screen.findByRole("option", { name: "30 minutes" }),
		);
		await userEvent.click(dialog.getByRole("button", { name: "Save" }));
		await waitFor(() =>
			expect(api.updateSchedule).toHaveBeenCalledWith("default", {
				name: "Default",
				rule: { kind: "interval", minutes: 30 },
			}),
		);
	});

	it("FR-12: deleting a schedule in use (409) explains why", async () => {
		const api = fakeApi();
		api.deleteSchedule.mockRejectedValue(
			new ApiError(409, {
				error: "schedule_in_use",
				usedBy: { domains: 2, links: 1 },
			}),
		);
		const { notifications } = await import("@mantine/notifications");
		const show = vi.spyOn(notifications, "show");
		renderWithApi(<SchedulesPage />, api);
		await userEvent.click(
			await screen.findByRole("button", { name: "Delete Quarter-hourly" }),
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Confirm delete Quarter-hourly" }),
		);
		await waitFor(() =>
			expect(show).toHaveBeenCalledWith(
				expect.objectContaining({
					message: expect.stringContaining("used by 2 domains and 1 links"),
				}),
			),
		);
	});
});
