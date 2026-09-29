"use client";

import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import { cssVariablesResolver, theme } from "@/lib/theme";

export function Providers({ children }: { children: ReactNode }) {
	const [queryClient] = useState(
		() =>
			new QueryClient({
				defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
			}),
	);
	return (
		<I18nextProvider i18n={i18n}>
			<QueryClientProvider client={queryClient}>
				<MantineProvider
					theme={theme}
					cssVariablesResolver={cssVariablesResolver}
				>
					<Notifications position="top-right" />
					{children}
				</MantineProvider>
			</QueryClientProvider>
		</I18nextProvider>
	);
}
