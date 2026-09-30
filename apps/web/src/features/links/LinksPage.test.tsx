import type { LinkInputRaw, LinkView } from "@linkwatch/core";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { type Api, ApiError } from "@/lib/api";
import { renderWithApi } from "@/test/render";
import { stubApi } from "@/test/stub-api";
import { LinksPage } from "./LinksPage";

const view = (over: Partial<LinkView>): LinkView => ({
	id: "L1",
	domain: "abc.com",
	url: "https://abc.com/",
	tags: [],
	method: "GET",
	expectedCodes: [{ from: 200, to: 399 }],
	timeoutS: 30,
	status: "pending",
	paused: false,
	createdAt: "2026-09-29T10:00:00.000Z",
	...over,
});

/** Fake API keeping the list in memory. */
function fakeApi(initial: LinkView[] = []) {
	let links = [...initial];
	const api = {
		...stubApi(),
		listLinks: vi.fn(async () => ({ items: links, cursor: null })),
		createLink: vi.fn(async (input: LinkInputRaw) => {
			if (links.some((l) => l.url === input.url)) {
				throw new ApiError(409, { error: "duplicate", existingId: "L0" });
			}
			const created = view({
				id: `N${links.length}`,
				url: input.url,
				name: input.name ?? undefined,
			});
			links = [...links, created];
			return created;
		}),
		deleteLink: vi.fn(async (id: string) => {
			links = links.filter((l) => l.id !== id);
		}),
	} satisfies Api;
	return api;
}

describe("LinksPage", () => {
	it("shows the 4 statuses Up / Slow / Dead link / Site down with HTTP code and response time", async () => {
		renderWithApi(
			<LinksPage />,
			fakeApi([
				view({
					id: "a",
					url: "https://a.vn/",
					status: "up",
					lastHttpCode: 200,
					lastResponseMs: 120,
					lastCheckedAt: "2026-09-29T23:01:00.000Z",
				}),
				view({
					id: "b",
					url: "https://b.vn/",
					status: "slow",
					lastHttpCode: 200,
					lastResponseMs: 7200,
				}),
				view({
					id: "c",
					url: "https://c.vn/",
					status: "dead",
					lastHttpCode: 404,
					lastErrorType: "http_4xx",
				}),
				view({
					id: "d",
					url: "https://d.vn/",
					status: "down",
					lastErrorType: "dns",
				}),
				view({ id: "e", url: "https://e.vn/", status: "pending" }),
			]),
		);
		const row = async (url: string) =>
			within((await screen.findByText(url)).closest("tr") as HTMLElement);
		expect((await row("https://a.vn/")).getByText("Up")).toBeTruthy();
		expect((await row("https://a.vn/")).getByText("120 ms")).toBeTruthy();
		expect(
			(await row("https://a.vn/")).getByText("30/09/2026 06:01"),
		).toBeTruthy();
		expect((await row("https://b.vn/")).getByText("Slow")).toBeTruthy();
		expect((await row("https://b.vn/")).getByText("7,200 ms")).toBeTruthy();
		expect((await row("https://c.vn/")).getByText("Dead link")).toBeTruthy();
		expect((await row("https://c.vn/")).getByText("404")).toBeTruthy();
		expect((await row("https://d.vn/")).getByText("Site down")).toBeTruthy();
		expect((await row("https://d.vn/")).getByText("DNS error")).toBeTruthy();
		expect((await row("https://e.vn/")).getByText("Pending")).toBeTruthy();
	});

	it("FR-01: invalid URL → error under the URL field, API not called", async () => {
		const api = fakeApi();
		renderWithApi(<LinksPage />, api);
		await openForm();
		await userEvent.type(
			await screen.findByRole("textbox", { name: /URL/ }),
			"ftp://abc.com",
		);
		await userEvent.click(screen.getByRole("button", { name: "Add link" }));
		expect(
			await screen.findByText("Only http:// and https:// are supported"),
		).toBeTruthy();
		expect(api.createLink).not.toHaveBeenCalled();
	});

	it("FR-01, FR-02: adding a link calls the API with the normalised URL, shows it in the table and clears the input", async () => {
		const api = fakeApi();
		renderWithApi(<LinksPage />, api);
		await openForm();
		const input = await screen.findByRole("textbox", { name: /URL/ });
		await userEvent.type(input, "  HTTPS://Moi.ABC.com/x#top ");
		await userEvent.type(screen.getByLabelText(/Display name/), "New page");
		await userEvent.click(screen.getByRole("button", { name: "Add link" }));
		await waitFor(() => expect(api.createLink).toHaveBeenCalledTimes(1));
		expect(api.createLink.mock.calls[0][0]).toMatchObject({
			url: "https://moi.abc.com/x",
			name: "New page",
		});
		expect(await screen.findByText("https://moi.abc.com/x")).toBeTruthy();
		expect((input as HTMLInputElement).value).toBe("");
	});

	it("FR-02: duplicate URL (409) → says the link already exists", async () => {
		const api = fakeApi([view({ url: "https://abc.com/" })]);
		renderWithApi(<LinksPage />, api);
		await openForm();
		await userEvent.type(
			await screen.findByRole("textbox", { name: /URL/ }),
			"https://abc.com",
		);
		await userEvent.click(screen.getByRole("button", { name: "Add link" }));
		expect(
			await screen.findByText("This link is already in the list"),
		).toBeTruthy();
	});

	it("FR-04: delete needs a second confirming click, then the link disappears", async () => {
		const api = fakeApi([view({ id: "x", url: "https://xoa.vn/" })]);
		renderWithApi(<LinksPage />, api);
		const row = within(
			(await screen.findByText("https://xoa.vn/")).closest("tr") as HTMLElement,
		);
		await userEvent.click(row.getByRole("button", { name: "Delete" }));
		expect(api.deleteLink).not.toHaveBeenCalled();
		await userEvent.click(row.getByRole("button", { name: "Confirm delete" }));
		await waitFor(() => expect(api.deleteLink).toHaveBeenCalledWith("x"));
		await waitFor(() =>
			expect(screen.queryByText("https://xoa.vn/")).toBeNull(),
		);
	});

	it("empty list → prompts to add the first link", async () => {
		renderWithApi(<LinksPage />, fakeApi());
		expect(
			await screen.findByText("No links yet. Add your first link above."),
		).toBeTruthy();
	});

	it("FR-28: expired session (401) → no error box (the API client signs out, the gate shows sign-in)", async () => {
		const api = fakeApi();
		api.listLinks.mockRejectedValue(
			new ApiError(401, { error: "unauthorized" }),
		);
		renderWithApi(<LinksPage />, api);
		await waitFor(() => expect(api.listLinks).toHaveBeenCalled());
		expect(screen.queryByText(/could not load/i)).toBeNull();
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("colours: status icon matches its meaning, Up/Site down/5xx use the shared success/danger colours, Delete is red", async () => {
		renderWithApi(
			<LinksPage />,
			fakeApi([
				view({
					id: "a",
					url: "https://a.vn/",
					status: "up",
					lastHttpCode: 200,
				}),
				view({
					id: "c",
					url: "https://c.vn/",
					status: "dead",
					lastHttpCode: 404,
				}),
				view({
					id: "d",
					url: "https://d.vn/",
					status: "down",
					lastHttpCode: 503,
				}),
			]),
		);
		const row = async (url: string) =>
			within((await screen.findByText(url)).closest("tr") as HTMLElement);
		const up = await row("https://a.vn/");
		expect(up.getByTestId("status-icon").getAttribute("data-icon")).toBe(
			"circle-check",
		);
		const dead = await row("https://c.vn/");
		expect(dead.getByTestId("status-icon").getAttribute("data-icon")).toBe(
			"unlink",
		);
		expect(dead.getByText("404").getAttribute("style")).toContain("orange-7");
		const down = await row("https://d.vn/");
		expect(down.getByTestId("status-icon").getAttribute("data-icon")).toBe(
			"circle-x",
		);
		expect(down.getByText("503").getAttribute("style")).toContain(
			"--lw-color-danger",
		);
		expect(down.getByText("Site down").getAttribute("style")).toContain(
			"--lw-color-danger",
		);
		expect(up.getByText("Up").getAttribute("style")).toContain(
			"--lw-color-success",
		);
		expect(up.getByText("200").getAttribute("style") ?? "").not.toMatch(
			/orange|red|danger/,
		);
		const del = up.getByRole("button", { name: "Delete" });
		expect(del.getAttribute("style")).toContain("red");
	});

	it("table: header row is pinned and the table scrolls inside a viewport-high container", async () => {
		renderWithApi(<LinksPage />, fakeApi([view({ url: "https://a.vn/" })]));
		await screen.findByText("https://a.vn/");
		const thead = document.querySelector("thead") as HTMLElement;
		expect(thead.getAttribute("data-sticky")).toBe("true");
		const scroll = thead.closest("[data-table-scroll]") as HTMLElement;
		expect(scroll).toBeTruthy();
		// Mobile bleed (negative margins) lives in this CSS module class.
		expect(scroll.className).toMatch(/scroll/);
	});

	it("columns: URL first, then Status right after it, then Domain", async () => {
		renderWithApi(<LinksPage />, fakeApi([view({ url: "https://a.vn/" })]));
		await screen.findByText("https://a.vn/");
		const headers = screen
			.getAllByRole("columnheader")
			.map((th) => th.textContent);
		expect(headers.slice(0, 7)).toEqual([
			"URL",
			"Status",
			"Domain",
			"HTTP",
			"Response",
			"Last checked",
			"Added",
		]);
	});

	it("Added column shows when each link was created (Vietnam time)", async () => {
		renderWithApi(
			<LinksPage />,
			fakeApi([
				view({ url: "https://a.vn/", createdAt: "2026-09-29T17:05:00.000Z" }),
			]),
		);
		const row = within(
			(await screen.findByText("https://a.vn/")).closest("tr") as HTMLElement,
		);
		expect(row.getByText("30/09/2026 00:05")).toBeTruthy();
	});

	it("sorting: clicking a header sorts the rows, again flips, a third time restores the API order", async () => {
		renderWithApi(
			<LinksPage />,
			fakeApi([
				view({ id: "a", url: "https://a.vn/", lastResponseMs: 300 }),
				view({ id: "b", url: "https://b.vn/", lastResponseMs: 7200 }),
				view({ id: "c", url: "https://c.vn/" }),
				view({ id: "d", url: "https://d.vn/", lastResponseMs: 50 }),
			]),
		);
		await screen.findByText("https://a.vn/");
		const order = () =>
			screen
				.getAllByRole("row")
				.slice(1)
				.map((r) => within(r).getByRole("link").textContent);
		const sortButton = screen.getByRole("button", { name: "Sort by Response" });
		const header = () => sortButton.closest("th") as HTMLElement;
		expect(header().getAttribute("aria-sort")).toBe("none");

		await userEvent.click(sortButton);
		// Slowest first; a never-checked link stays last.
		expect(order()).toEqual([
			"https://b.vn/",
			"https://a.vn/",
			"https://d.vn/",
			"https://c.vn/",
		]);
		expect(header().getAttribute("aria-sort")).toBe("descending");

		await userEvent.click(sortButton);
		expect(order()).toEqual([
			"https://d.vn/",
			"https://a.vn/",
			"https://b.vn/",
			"https://c.vn/",
		]);
		expect(header().getAttribute("aria-sort")).toBe("ascending");

		await userEvent.click(sortButton);
		expect(order()).toEqual([
			"https://a.vn/",
			"https://b.vn/",
			"https://c.vn/",
			"https://d.vn/",
		]);
		expect(header().getAttribute("aria-sort")).toBe("none");
	});

	describe("adaptive refresh", () => {
		it("FR-17: a link waiting for its first check → says it refreshes every 30 seconds", async () => {
			renderWithApi(
				<LinksPage />,
				fakeApi([view({ url: "https://a.vn/", status: "pending" })]),
			);
			expect(
				await screen.findByText(
					"Refreshing every 30 seconds while links wait for a check result.",
				),
			).toBeTruthy();
		});

		it("every result settled → says it refreshes every 5 minutes", async () => {
			renderWithApi(
				<LinksPage />,
				fakeApi([view({ url: "https://a.vn/", status: "up" })]),
			);
			expect(
				await screen.findByText(
					"Refreshes every 5 minutes. New links are checked within 5 minutes.",
				),
			).toBeTruthy();
		});

		it("Refresh button reloads the list right away and shows the update time", async () => {
			const api = fakeApi([view({ url: "https://a.vn/", status: "up" })]);
			renderWithApi(<LinksPage />, api);
			await screen.findByText("https://a.vn/");
			expect(screen.getByText(/^Updated \d\d:\d\d:\d\d$/)).toBeTruthy();
			const calls = api.listLinks.mock.calls.length;
			await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
			await waitFor(() =>
				expect(api.listLinks.mock.calls.length).toBeGreaterThan(calls),
			);
		});
	});

	describe("filters", () => {
		const data = () =>
			fakeApi([
				view({
					id: "a",
					url: "https://shop.abc.com/pricing",
					domain: "abc.com",
					status: "up",
					lastCheckedAt: "2026-09-29T23:01:00.000Z", // 30/09 06:01 VN
				}),
				view({
					id: "b",
					url: "https://xyz.vn/blog",
					domain: "xyz.vn",
					status: "dead",
					lastCheckedAt: "2026-09-28T23:01:00.000Z", // 29/09 06:01 VN
				}),
				view({ id: "c", url: "https://xyz.vn/new", domain: "xyz.vn" }),
			]);
		const urls = () =>
			screen
				.queryAllByRole("row")
				.slice(1)
				.map((r) => within(r).getByRole("link").textContent);

		it("FR-17: search by URL or domain filters the rows live and shows the count", async () => {
			renderWithApi(<LinksPage />, data());
			await screen.findByText("https://xyz.vn/blog");
			expect(screen.getByText("Showing 3 of 3 links")).toBeTruthy();
			await userEvent.type(
				screen.getByRole("textbox", { name: "Search" }),
				"XYZ",
			);
			await waitFor(() =>
				expect(urls()).toEqual(["https://xyz.vn/blog", "https://xyz.vn/new"]),
			);
			expect(screen.getByText("Showing 2 of 3 links")).toBeTruthy();
		});

		it("FR-17: status chips keep only the chosen statuses", async () => {
			renderWithApi(<LinksPage />, data());
			await screen.findByText("https://xyz.vn/blog");
			const chips = within(screen.getByRole("group", { name: "Status" }));
			await userEvent.click(chips.getByText("Dead link"));
			await waitFor(() => expect(urls()).toEqual(["https://xyz.vn/blog"]));
		});

		it("FR-17: check date range keeps links last checked on those days", async () => {
			renderWithApi(<LinksPage />, data());
			await screen.findByText("https://xyz.vn/blog");
			await userEvent.type(screen.getByLabelText("Checked from"), "2026-09-30");
			await waitFor(() =>
				expect(urls()).toEqual(["https://shop.abc.com/pricing"]),
			);
		});

		it("FR-17: an end date before the start date shows an error and keeps the last valid filter", async () => {
			renderWithApi(<LinksPage />, data());
			await screen.findByText("https://xyz.vn/blog");
			await userEvent.type(screen.getByLabelText("Checked from"), "2026-09-30");
			await userEvent.type(screen.getByLabelText("Checked to"), "2026-09-01");
			expect(
				await screen.findByText("Must be on or after the start date"),
			).toBeTruthy();
			expect(urls()).toEqual(["https://shop.abc.com/pricing"]);
		});

		it("no match → says so; Clear filters shows every link again", async () => {
			renderWithApi(<LinksPage />, data());
			await screen.findByText("https://xyz.vn/blog");
			await userEvent.type(
				screen.getByRole("textbox", { name: "Search" }),
				"nothing-here",
			);
			expect(
				await screen.findByText("No links match the filters."),
			).toBeTruthy();
			await userEvent.click(
				screen.getByRole("button", { name: "Clear filters" }),
			);
			await waitFor(() => expect(urls()).toHaveLength(3));
			expect(
				(screen.getByRole("textbox", { name: "Search" }) as HTMLInputElement)
					.value,
			).toBe("");
		});

		it("filters and sorting work together", async () => {
			renderWithApi(<LinksPage />, data());
			await screen.findByText("https://xyz.vn/blog");
			await userEvent.type(
				screen.getByRole("textbox", { name: "Search" }),
				"xyz",
			);
			await userEvent.click(
				screen.getByRole("button", { name: "Sort by URL" }),
			);
			await waitFor(() =>
				expect(urls()).toEqual(["https://xyz.vn/blog", "https://xyz.vn/new"]),
			);
			await userEvent.click(
				screen.getByRole("button", { name: "Sort by URL" }),
			);
			expect(urls()).toEqual(["https://xyz.vn/new", "https://xyz.vn/blog"]);
		});

		it("no links at all → no filter form, the usual empty prompt", async () => {
			renderWithApi(<LinksPage />, fakeApi([]));
			expect(await screen.findByText(/add your first link/i)).toBeTruthy();
			expect(screen.queryByRole("search")).toBeNull();
		});
	});

	it("sorting: every column header is a sort button", async () => {
		renderWithApi(<LinksPage />, fakeApi([view({ url: "https://a.vn/" })]));
		await screen.findByText("https://a.vn/");
		for (const col of [
			"URL",
			"Status",
			"Domain",
			"HTTP",
			"Response",
			"Last checked",
			"Added",
		])
			expect(
				screen.getByRole("button", { name: `Sort by ${col}` }),
			).toBeTruthy();
	});

	it("URL column is pinned (sticky) in the header and every row for horizontal scrolling", async () => {
		renderWithApi(
			<LinksPage />,
			fakeApi([
				view({ id: "a", url: "https://a.vn/" }),
				view({ id: "b", url: "https://b.vn/" }),
			]),
		);
		await screen.findByText("https://a.vn/");
		const [urlHeader] = screen.getAllByRole("columnheader");
		expect(urlHeader.getAttribute("data-sticky")).toBe("true");
		for (const row of screen.getAllByRole("row").slice(1)) {
			const first = row.querySelector("td");
			expect(first?.getAttribute("data-sticky")).toBe("true");
		}
	});

	it('form: only "+ Add" is shown until clicked, then it is replaced by the fields and "Add link"', async () => {
		const api = fakeApi();
		renderWithApi(<LinksPage />, api);
		await screen.findByRole("button", { name: "Add" });
		expect(screen.queryByRole("textbox", { name: /URL/ })).toBeNull();
		expect(screen.queryByRole("button", { name: "Add link" })).toBeNull();
		await openForm();
		expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
		expect(screen.getByRole("button", { name: "Add link" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
		// Opening must not submit the empty form.
		expect(screen.queryByText("Invalid URL")).toBeNull();
		expect(api.createLink).not.toHaveBeenCalled();
	});

	it("form: fields come before the actions and URL is focused on open", async () => {
		renderWithApi(<LinksPage />, fakeApi());
		await openForm();
		const url = await screen.findByRole("textbox", { name: /URL/ });
		const name = screen.getByLabelText(/Display name/);
		const submit = screen.getByRole("button", { name: "Add link" });
		const fields = url.closest("[data-form-fields]") as HTMLElement;
		expect(fields).toBeTruthy();
		expect(fields.contains(name)).toBe(true);
		expect(fields.contains(submit)).toBe(false);
		expect(
			fields.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		await waitFor(() => expect(document.activeElement).toBe(url));
	});

	it('form: Cancel clears the fields, closes the form and focuses "+ Add"', async () => {
		renderWithApi(<LinksPage />, fakeApi());
		await openForm();
		await userEvent.type(
			await screen.findByRole("textbox", { name: /URL/ }),
			"https://abc.com",
		);
		await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(screen.queryByRole("textbox", { name: /URL/ })).toBeNull();
		const add = screen.getByRole("button", { name: "Add" });
		await waitFor(() => expect(document.activeElement).toBe(add));
		await openForm();
		expect(
			(screen.getByRole("textbox", { name: /URL/ }) as HTMLInputElement).value,
		).toBe("");
	});

	it("form: Cancel and Add link share one row, Cancel on the left", async () => {
		renderWithApi(<LinksPage />, fakeApi());
		await openForm();
		const submit = screen.getByRole("button", { name: "Add link" });
		const cancel = screen.getByRole("button", { name: "Cancel" });
		const actions = submit.closest("[data-form-actions]") as HTMLElement;
		expect(actions?.contains(cancel)).toBe(true);
		expect(
			cancel.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});

	it("form: Display name has a placeholder", async () => {
		renderWithApi(<LinksPage />, fakeApi());
		await openForm();
		expect(
			screen.getByLabelText(/Display name/).getAttribute("placeholder"),
		).toBe("e.g. Pricing page (optional)");
	});

	it("form: Escape closes the form", async () => {
		renderWithApi(<LinksPage />, fakeApi());
		await openForm();
		await userEvent.type(
			await screen.findByRole("textbox", { name: /URL/ }),
			"{Escape}",
		);
		expect(screen.queryByRole("textbox", { name: /URL/ })).toBeNull();
		expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
	});

	it("FR-01: after a successful add the form stays open with URL focused for the next link", async () => {
		const api = fakeApi();
		renderWithApi(<LinksPage />, api);
		await openForm();
		const url = await screen.findByRole("textbox", { name: /URL/ });
		await userEvent.type(url, "https://abc.com/a");
		await userEvent.click(screen.getByRole("button", { name: "Add link" }));
		await waitFor(() => expect(api.createLink).toHaveBeenCalledTimes(1));
		await waitFor(() => expect((url as HTMLInputElement).value).toBe(""));
		expect(screen.getByRole("button", { name: "Add link" })).toBeTruthy();
		await waitFor(() => expect(document.activeElement).toBe(url));
	});
});

/** The add form starts collapsed; the first click on Add shows the fields. */
async function openForm() {
	await userEvent.click(await screen.findByRole("button", { name: "Add" }));
}
