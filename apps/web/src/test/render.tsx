import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import type { Api } from "@/lib/api";
import { ApiContext } from "@/lib/api-context";
import { AuthContext, type AuthState } from "@/lib/auth-context";
import { cssVariablesResolver, theme } from "@/lib/theme";

/** Signed in as admin@abc.com unless a test overrides it. */
export const signedInAuth = (over: Partial<AuthState> = {}): AuthState => ({
	status: "signedIn",
	user: { email: "admin@abc.com" },
	client: null,
	refresh: async () => {},
	signOut: async () => {},
	...over,
});

/** Renders with the same providers as the app, using a fake API and a fake session. */
export function renderWithApi(
	ui: ReactElement,
	api: Api,
	auth: AuthState = signedInAuth(),
) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(
		<I18nextProvider i18n={i18n}>
			<QueryClientProvider client={client}>
				<MantineProvider
					theme={theme}
					cssVariablesResolver={cssVariablesResolver}
				>
					<AuthContext.Provider value={auth}>
						<ApiContext.Provider value={api}>{ui}</ApiContext.Provider>
					</AuthContext.Provider>
				</MantineProvider>
			</QueryClientProvider>
		</I18nextProvider>,
	);
}
