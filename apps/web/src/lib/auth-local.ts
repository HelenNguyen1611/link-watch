import type { AuthClient } from "./auth";

const STORAGE_KEY = "linkwatch.localSession";
/** The local API (`pnpm dev:api`) signs any `Bearer …` in as `LOCAL_USER_EMAIL`. */
export const LOCAL_ID_TOKEN = "local-dev";

const storage = () => {
	try {
		return typeof window === "undefined" ? null : window.localStorage;
	} catch {
		return null;
	}
};

/** `next dev` only (see `loadAuthSetup`): any email and non-empty password sign in. */
export function createLocalAuth(): AuthClient {
	const email = () => storage()?.getItem(STORAGE_KEY) ?? null;
	return {
		async currentUser() {
			const e = email();
			return e ? { email: e } : null;
		},
		async getIdToken() {
			return email() ? LOCAL_ID_TOKEN : null;
		},
		async signIn(address) {
			storage()?.setItem(STORAGE_KEY, address.trim().toLowerCase());
			return { kind: "signedIn" };
		},
		async completeNewPassword() {},
		async requestPasswordReset() {},
		async confirmPasswordReset() {},
		async signOut() {
			storage()?.removeItem(STORAGE_KEY);
		},
	};
}
