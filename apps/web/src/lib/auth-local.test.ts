import { beforeEach, describe, expect, it } from "vitest";
import { createLocalAuth, LOCAL_ID_TOKEN } from "./auth-local";

beforeEach(() => localStorage.clear());

describe("createLocalAuth (next dev only)", () => {
	it("any email signs in, the fake token is sent to the local API, sign out clears it", async () => {
		const auth = createLocalAuth();
		expect(await auth.currentUser()).toBeNull();
		expect(await auth.getIdToken()).toBeNull();
		expect(await auth.signIn(" Dev@Local.Test ", "x")).toEqual({
			kind: "signedIn",
		});
		expect(await auth.currentUser()).toEqual({ email: "dev@local.test" });
		expect(await auth.getIdToken()).toBe(LOCAL_ID_TOKEN);
		// The session survives a reload (new client, same browser storage).
		expect(await createLocalAuth().currentUser()).toEqual({
			email: "dev@local.test",
		});
		await auth.signOut();
		expect(await auth.currentUser()).toBeNull();
	});
});
