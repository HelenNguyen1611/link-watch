import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import { ColorSchemeScript, mantineHtmlProps } from "@mantine/core";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Providers } from "./providers";

// Inter is downloaded at build time and served with the site (no request to Google at runtime).
const inter = Inter({
	subsets: ["latin"],
	variable: "--font-inter",
	display: "swap",
});

export const metadata: Metadata = {
	title: "LinkWatch",
	description: "Monitor dead links and site outages",
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en" className={inter.variable} {...mantineHtmlProps}>
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
