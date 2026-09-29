import { createTheme, type MantineColorsTuple } from "@mantine/core";

/** Teal from the logo (Logo.tsx, #0F766E = shade 7). */
const brand: MantineColorsTuple = [
	"#f0fdfa",
	"#ccfbf1",
	"#99f6e4",
	"#5eead4",
	"#2dd4bf",
	"#14b8a6",
	"#0d9488",
	"#0f766e",
	"#115e59",
	"#134e4a",
];

/**
 * Minimal style (inspired by woogroup.com.au): white background, black text, one accent colour,
 * hairlines, no shadows, large medium-weight headings, slightly tight tracking.
 */
export const theme = createTheme({
	primaryColor: "brand",
	primaryShade: 7,
	colors: { brand },
	black: "#000000",
	fontFamily:
		"var(--font-inter), -apple-system, 'Helvetica Neue', Arial, sans-serif",
	defaultRadius: "xs",
	headings: {
		fontWeight: "500",
		sizes: {
			h1: { fontSize: "2.5rem", lineHeight: "1.25" },
			h2: { fontSize: "1.625rem", lineHeight: "1.4" },
			h3: { fontSize: "1.25rem", lineHeight: "1.4" },
		},
	},
	shadows: { xs: "none", sm: "none", md: "none", lg: "none", xl: "none" },
	other: { border: "#E6E6E6", dimmed: "#8C8C8C", maxWidth: 1152 },
});
