/**
 * Semantic colours shared by the whole site. Use these instead of raw Mantine shades
 * so every "healthy" green and every "error" red is the same colour.
 *
 * - `COLOR.*` are CSS variables (set in `cssVariablesResolver`, lib/theme.ts) for `c=`, `style` and CSS.
 * - `PALETTE.*` are Mantine palette names for the `color=` prop of Button, Alert, Notification…
 *   (their light variant text resolves to the same shades as `COLOR.*`).
 */
export const COLOR = {
	/** Healthy / success: the brand teal (#0F766E). */
	success: "var(--lw-color-success)",
	/** Error / outage / destructive: one red (#C92A2A, AA contrast on white). */
	danger: "var(--lw-color-danger)",
} as const;

export const PALETTE = {
	success: "brand",
	danger: "red",
} as const;
