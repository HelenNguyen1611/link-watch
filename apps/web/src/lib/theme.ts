import { createTheme, type MantineColorsTuple } from "@mantine/core";

/** Xanh ngọc theo logo (Logo.tsx, #0F766E = shade 7). */
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
 * Phong cách tối giản (tham khảo woogroup.com.au): nền trắng, chữ đen, một màu nhấn,
 * đường kẻ mảnh, không đổ bóng, tiêu đề lớn đậm vừa, chữ hơi khít.
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
