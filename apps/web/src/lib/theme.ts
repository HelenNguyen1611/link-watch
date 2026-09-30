import {
	type CSSVariablesResolver,
	createTheme,
	type MantineColorsTuple,
} from "@mantine/core";

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
			// Fluid: 36px at 390px wide, growing linearly to 40px from 1280px up.
			h1: {
				fontSize: "clamp(2.25rem, 2.14rem + 0.45vw, 2.5rem)",
				lineHeight: "1.25",
			},
			h2: { fontSize: "1.625rem", lineHeight: "1.4" },
			h3: { fontSize: "1.25rem", lineHeight: "1.4" },
		},
	},
	shadows: { xs: "none", sm: "none", md: "none", lg: "none", xl: "none" },
	other: {
		border: "#E6E6E6",
		dimmed: "#8C8C8C",
		/** Content fills the width up to this viewport width, then stops growing (AppLayout). */
		maxViewportWidth: 1920,
	},
});

/**
 * Semantic colour variables (see lib/colors.ts). `--mantine-color-error` is pointed at the same red,
 * so input errors, the required asterisk and error borders match the rest of the site.
 */
const semantic = {
	"--lw-color-success": "var(--mantine-color-brand-7)",
	"--lw-color-danger": "var(--mantine-color-red-9)",
	"--mantine-color-error": "var(--lw-color-danger)",
};

export const cssVariablesResolver: CSSVariablesResolver = () => ({
	variables: {},
	light: semantic,
	dark: semantic,
});
