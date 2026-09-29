"use client";

import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { API_BASE, createApi } from "./api";
import { ApiContext } from "./api-context";
import {
	type AuthClient,
	type AuthUser,
	loadAuthSetup,
	UNAUTHORIZED_EVENT,
} from "./auth";
import { createCognitoAuth } from "./auth-cognito";
import { createLocalAuth } from "./auth-local";

export type AuthStatus = "loading" | "signedIn" | "signedOut" | "unconfigured";

export type AuthState = {
	status: AuthStatus;
	user: AuthUser | null;
	/** null while loading or when sign-in is not configured. */
	client: AuthClient | null;
	/** Re-reads the session (after signing in). */
	refresh: () => Promise<void>;
	signOut: () => Promise<void>;
};

const noop = async () => {};

export const AuthContext = createContext<AuthState>({
	status: "loading",
	user: null,
	client: null,
	refresh: noop,
	signOut: noop,
});
export const useAuth = () => useContext(AuthContext);

/** Production: Cognito from `/auth-config.json`; `next dev` without it: local fake sign-in. */
async function defaultClient(): Promise<AuthClient | null> {
	const setup = await loadAuthSetup({
		fetch: (...args) => fetch(...args),
		dev: process.env.NODE_ENV === "development",
	});
	if (setup.kind === "cognito") return createCognitoAuth(setup.config);
	if (setup.kind === "local") return createLocalAuth();
	return null;
}

/**
 * FR-28: holds the session and provides the API client that sends the ID token.
 * A 401 from the API (session expired or revoked) signs out, so the gate shows the sign-in page.
 */
export function AuthProvider({
	children,
	loadClient = defaultClient,
}: {
	children: ReactNode;
	loadClient?: () => Promise<AuthClient | null>;
}) {
	const [client, setClient] = useState<AuthClient | null>(null);
	const [status, setStatus] = useState<AuthStatus>("loading");
	const [user, setUser] = useState<AuthUser | null>(null);

	const readSession = useCallback(async (c: AuthClient) => {
		const current = await c.currentUser().catch(() => null);
		setUser(current);
		setStatus(current ? "signedIn" : "signedOut");
	}, []);

	useEffect(() => {
		let cancelled = false;
		loadClient().then((c) => {
			if (cancelled) return;
			if (!c) {
				setStatus("unconfigured");
				return;
			}
			setClient(c);
			readSession(c);
		});
		return () => {
			cancelled = true;
		};
	}, [loadClient, readSession]);

	const signOut = useCallback(async () => {
		await client?.signOut().catch(() => {});
		setUser(null);
		setStatus(client ? "signedOut" : "unconfigured");
	}, [client]);

	useEffect(() => {
		const onUnauthorized = () => {
			signOut();
		};
		window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
		return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
	}, [signOut]);

	const refresh = useCallback(async () => {
		if (client) await readSession(client);
	}, [client, readSession]);

	const api = useMemo(
		() =>
			createApi({
				baseUrl: API_BASE,
				getToken: async () => (client ? client.getIdToken() : null),
			}),
		[client],
	);
	const value = useMemo(
		() => ({ status, user, client, refresh, signOut }),
		[status, user, client, refresh, signOut],
	);

	return (
		<AuthContext.Provider value={value}>
			<ApiContext.Provider value={api}>{children}</ApiContext.Provider>
		</AuthContext.Provider>
	);
}
