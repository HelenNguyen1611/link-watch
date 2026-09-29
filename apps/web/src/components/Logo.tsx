import { Group, Text } from "@mantine/core";

// Same mark as the favicon (src/app/icon.svg): white heartbeat on teal.
export const BRAND_COLOR = "#0F766E";

export function LogoMark({ size = 28 }: { size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 32 32"
			aria-hidden="true"
			focusable="false"
		>
			<rect width="32" height="32" rx="7" fill={BRAND_COLOR} />
			<path
				d="M5 17h5l3-8 5 15 3-7h6"
				fill="none"
				stroke="#fff"
				strokeWidth="3.2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

export function Logo({ label, size = 28 }: { label: string; size?: number }) {
	return (
		<Group gap={8} wrap="nowrap">
			<LogoMark size={size} />
			<Text
				component="span"
				fw={700}
				size="lg"
				lh={1}
				style={{ letterSpacing: "-0.01em" }}
			>
				{label}
			</Text>
		</Group>
	);
}
