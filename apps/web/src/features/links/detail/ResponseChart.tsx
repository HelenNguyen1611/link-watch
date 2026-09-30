"use client";

import type { CheckView } from "@linkwatch/core";
import { Box, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import {
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { COLOR } from "@/lib/colors";
import { formatDateTime } from "@/lib/format";

type Point = { at: string; ms: number; failed: boolean };

/** Oldest first, for the time axis. */
export const toPoints = (checks: readonly CheckView[]): Point[] =>
	[...checks].reverse().map((c) => ({
		at: c.checkedAt,
		ms: c.responseMs,
		failed: c.result === "dead" || c.result === "down",
	}));

function Dot(props: { cx?: number; cy?: number; payload?: Point }) {
	const { cx, cy, payload } = props;
	if (cx === undefined || cy === undefined) return null;
	return (
		<circle
			cx={cx}
			cy={cy}
			r={payload?.failed ? 4 : 2.5}
			fill={payload?.failed ? COLOR.danger : COLOR.success}
			stroke="none"
		/>
	);
}

/** FR-18: response time of the last checks; failed checks are red dots. */
export function ResponseChart({ checks }: { checks: readonly CheckView[] }) {
	const { t } = useTranslation();
	const points = toPoints(checks);
	if (points.length === 0)
		return (
			<Text c="dimmed" size="sm">
				{t("linkDetail.chart.empty")}
			</Text>
		);
	return (
		<Box h={220} role="img" aria-label={t("linkDetail.chart.title")}>
			<ResponsiveContainer width="100%" height="100%">
				<LineChart
					data={points}
					margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
				>
					<CartesianGrid
						stroke="var(--mantine-color-gray-2)"
						vertical={false}
					/>
					<XAxis
						dataKey="at"
						tickFormatter={(v: string) => formatDateTime(v).slice(0, 5)}
						minTickGap={32}
						tick={{ fontSize: 11 }}
					/>
					<YAxis
						width={56}
						tick={{ fontSize: 11 }}
						tickFormatter={(v: number) => `${v} ms`}
					/>
					<Tooltip
						labelFormatter={(v) => formatDateTime(String(v))}
						formatter={(v) => [`${v} ms`, t("linkDetail.chart.responseTime")]}
					/>
					<Line
						type="monotone"
						dataKey="ms"
						stroke="var(--mantine-color-gray-5)"
						strokeWidth={1.5}
						dot={<Dot />}
						isAnimationActive={false}
					/>
				</LineChart>
			</ResponsiveContainer>
		</Box>
	);
}
