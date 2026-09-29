import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import { ColorSchemeScript, mantineHtmlProps } from "@mantine/core";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Providers } from "./providers";

// Inter tải lúc build và phục vụ cùng web (không gọi Google khi người dùng mở trang).
const inter = Inter({
	subsets: ["latin", "vietnamese"],
	variable: "--font-inter",
	display: "swap",
});

export const metadata: Metadata = {
	title: "LinkWatch",
	description: "Theo dõi link chết và site down",
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="vi" className={inter.variable} {...mantineHtmlProps}>
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
