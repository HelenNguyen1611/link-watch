import type { IncidentView } from "@linkwatch/core";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Api, ClaimProgressDto, TokenClaimView } from "@/lib/api";
import { renderWithApi, signedInAuth } from "@/test/render";
import { stubApi } from "@/test/stub-api";
import { ConfirmPage } from "./ConfirmPage";

let search = new URLSearchParams({ token: "tok" });
vi.mock("next/navigation", () => ({
	useSearchParams: () => search,
	usePathname: () => "/confirm/",
	useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
beforeEach(() => {
	search = new URLSearchParams({ token: "tok" });
});
afterEach(() => vi.useRealTimers());

const incident = (over: Partial<IncidentView> = {}): IncidentView => ({
	id: "L1@2026-09-30T03:00:00.000Z",
	linkId: "L1",
	domain: "abc.com",
	url: "https://abc.com/pricing",
	type: "dead",
	state: "open",
	openedAt: "2026-09-30T03:00:00.000Z",
	httpCode: 404,
	errorType: "http_4xx",
	...over,
});
const progress = (over: Partial<ClaimProgressDto> = {}): ClaimProgressDto => ({
	claimedAt: "2026-09-30T04:00:00.000Z",
	outcome: "pending",
	done: false,
	total: 3,
	attempts: [],
	byEmail: "lan@abc.com",
	channel: "email",
	...over,
});
const signedOut = signedInAuth({ status: "signedOut", user: null });

function fakeApi(initial: TokenClaimView) {
	let current = initial;
	const api = {
		...stubApi(),
		getPublicClaim: vi.fn(async () => current),
		submitPublicClaim: vi.fn(async () => {
			current = {
				status: "open",
				recipient: "lan@abc.com",
				items: [
					{
						incident: incident({ state: "verifying" }),
						progress: progress(),
						decision: "started",
					},
				],
			};
			return current;
		}),
	} satisfies Api;
	return {
		api,
		set: (v: TokenClaimView) => {
			current = v;
		},
	};
}

describe("ConfirmPage — SCR-10", () => {
	it("FR-35 / AC-11: opening the page only shows the incident; nothing is sent until the button is pressed", async () => {
		const { api } = fakeApi({
			status: "open",
			recipient: "lan@abc.com",
			items: [{ incident: incident() }],
		});
		renderWithApi(<ConfirmPage />, api, signedOut);
		expect(await screen.findByText("https://abc.com/pricing")).toBeTruthy();
		expect(screen.getByText("Dead link · HTTP 404 · 4xx error")).toBeTruthy();
		expect(api.submitPublicClaim).not.toHaveBeenCalled();
		expect(api.getPublicClaim).toHaveBeenCalledWith("tok");
	});

	it("FR-36 / FR-39: confirm with a note → progress, refreshed every 3 s until fixed", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const fake = fakeApi({
			status: "open",
			recipient: "lan@abc.com",
			items: [{ incident: incident() }],
		});
		renderWithApi(<ConfirmPage />, fake.api, signedOut);
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		await user.type(
			await screen.findByLabelText("Note (optional)"),
			"Fixed DNS",
		);
		await user.click(
			screen.getByRole("button", { name: "Confirm & check again" }),
		);
		await waitFor(() =>
			expect(fake.api.submitPublicClaim).toHaveBeenCalledWith({
				token: "tok",
				note: "Fixed DNS",
			}),
		);
		expect(await screen.findByText("Checking…")).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Confirm & check again" }),
		).toBeNull();
		fake.set({
			status: "recovered",
			items: [
				{
					incident: incident({
						state: "closed",
						closedAt: "2026-09-30T04:00:10.000Z",
						closedBy: "lan@abc.com",
					}),
					progress: progress({
						outcome: "fixed",
						done: true,
						attempts: [
							{
								attempt: 1,
								at: "2026-09-30T04:00:08.000Z",
								result: "up",
								httpCode: 200,
							},
						],
					}),
				},
			],
		});
		await act(async () => {
			vi.advanceTimersByTime(3_100);
		});
		expect(
			await screen.findByText(
				"Fixed — the link works again. Everyone was emailed.",
			),
		).toBeTruthy();
		expect(screen.getByText("Check 1: Up (HTTP 200)")).toBeTruthy();
		expect(screen.getByText(/fixed by lan@abc.com/)).toBeTruthy();
	});

	it("FR-38: still failing after 3 checks → says only you were told; can report again", async () => {
		const failed = progress({
			outcome: "still_failing",
			done: true,
			attempts: [1, 2, 3].map((n) => ({
				attempt: n,
				at: "2026-09-30T04:00:00.000Z",
				result: "dead",
				httpCode: 404,
			})),
		});
		const { api } = fakeApi({
			status: "open",
			recipient: "lan@abc.com",
			items: [{ incident: incident(), progress: failed }],
		});
		renderWithApi(<ConfirmPage />, api, signedOut);
		expect(
			await screen.findByText(/Still failing after 3 checks/),
		).toBeTruthy();
		expect(screen.getByText("Check 3: Dead link (HTTP 404)")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Confirm & check again" }),
		).toBeTruthy();
	});

	it("FR-42 / AC-12: recovered before anyone clicked → says so, no button", async () => {
		const { api } = fakeApi({
			status: "recovered",
			items: [
				{
					incident: incident({
						state: "closed",
						closedAt: "2026-09-30T03:30:00.000Z",
					}),
				},
			],
		});
		renderWithApi(<ConfirmPage />, api, signedOut);
		expect(await screen.findByText("Already back up")).toBeTruthy();
		expect(screen.getByText("Back up since 30/09/2026 10:30")).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Confirm & check again" }),
		).toBeNull();
	});

	it("AC-12: expired or missing token → expired message", async () => {
		const { api } = fakeApi({ status: "expired" });
		renderWithApi(<ConfirmPage />, api, signedOut);
		expect(await screen.findByText("This link has expired")).toBeTruthy();
		search = new URLSearchParams();
		renderWithApi(<ConfirmPage />, api, signedOut);
		expect(screen.getAllByText("This link has expired").length).toBeGreaterThan(
			0,
		);
	});
});
