import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../db/testing";
import { getAlertEmails, setAlertEmail } from "./alert-users";

let t: TestDb;
beforeAll(async () => {
	t = await createTestDb();
});
afterAll(() => t?.drop());

describe("alert users — FR-20", () => {
	it("FR-20: switching on before Settings exists creates it; other settings are kept", async () => {
		expect(await getAlertEmails(t.db)).toEqual([]);
		expect(await setAlertEmail(t.db, "B@abc.com", true)).toEqual(["b@abc.com"]);
		await t.db.Settings.patch({}).set({ senderName: "Ops" }).go();
		expect(await setAlertEmail(t.db, "a@abc.com", true)).toEqual([
			"a@abc.com",
			"b@abc.com",
		]);
		const { data } = await t.db.Settings.get({}).go();
		expect(data?.senderName).toBe("Ops");
	});

	it("FR-20: switching off removes the email; repeating is a no-op", async () => {
		expect(await setAlertEmail(t.db, "b@abc.com", false)).toEqual([
			"a@abc.com",
		]);
		expect(await setAlertEmail(t.db, "b@abc.com", false)).toEqual([
			"a@abc.com",
		]);
		expect(await getAlertEmails(t.db)).toEqual(["a@abc.com"]);
	});

	it("FR-20: concurrent toggles both land", async () => {
		await Promise.all([
			setAlertEmail(t.db, "c@abc.com", true),
			setAlertEmail(t.db, "d@abc.com", true),
		]);
		expect(await getAlertEmails(t.db)).toEqual([
			"a@abc.com",
			"c@abc.com",
			"d@abc.com",
		]);
	});
});
