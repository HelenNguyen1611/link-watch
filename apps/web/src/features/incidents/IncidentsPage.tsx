"use client";

import { Loader } from "@mantine/core";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/PageHeader";
import { IncidentDetail } from "./IncidentDetail";
import { IncidentList } from "./IncidentList";

/** `/incidents/` lists; `/incidents/?id=<incidentId>` (links in emails) shows one incident. */
function IncidentsContent() {
	const id = useSearchParams().get("id");
	return id ? <IncidentDetail id={id} /> : <IncidentList />;
}

/** SCR-07: incidents (FR-19). */
export function IncidentsPage() {
	const { t } = useTranslation();
	return (
		<>
			<PageHeader
				title={t("nav.incidents")}
				description={t("incidents.subtitle")}
				mb={24}
			/>
			{/* Static export: the query string is only known in the browser. */}
			<Suspense fallback={<Loader />}>
				<IncidentsContent />
			</Suspense>
		</>
	);
}
