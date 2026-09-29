import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import type { Api } from "@/lib/api";
import { ApiContext } from "@/lib/api-context";
import { cssVariablesResolver, theme } from "@/lib/theme";

/** Renders with the same providers as the app, using a fake API. */
export function renderWithApi(ui: ReactElement, api: Api) {
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
					<ApiContext.Provider value={api}>{ui}</ApiContext.Provider>
				</MantineProvider>
			</QueryClientProvider>
		</I18nextProvider>,
	);
}
