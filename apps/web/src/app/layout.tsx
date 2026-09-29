import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import { ColorSchemeScript, mantineHtmlProps } from "@mantine/core";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Providers } from "./providers";

export const metadata: Metadata = {
	title: "LinkWatch",
	description: "Theo dõi link chết và site down",
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="vi" {...mantineHtmlProps}>
			<head>
				<ColorSchemeScript />
			</head>
			<body>
				<Providers>
					<AppLayout>{children}</AppLayout>
				</Providers>
			</body>
		</html>
	);
}
