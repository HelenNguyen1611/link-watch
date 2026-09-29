import { Container, Text, Title } from "@mantine/core";

// SCR-01 Tổng quan theo domain — dữ liệu sẽ lấy từ API qua TanStack Query
export default function DashboardPage() {
	return (
		<Container py="xl">
			<Title order={1}>LinkWatch</Title>
			<Text c="dimmed">Tổng quan theo domain</Text>
		</Container>
	);
}
