"use client";

import { Loader } from "@mantine/core";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/PageHeader";
import { DomainDetail } from "./DomainDetail";
import { DomainList } from "./DomainList";

function Content() {
	const d = useSearchParams().get("d");
	return d ? <DomainDetail name={d} /> : <DomainList />;
}

/** SCR-02: domains list; `/domains/?d=<name>` shows one domain. */
export function DomainsPage() {
	const { t } = useTranslation();
	return (
		<>
			<PageHeader
				title={t("nav.domains")}
				description={t("domains.subtitle")}
				mb={24}
			/>
			<Suspense fallback={<Loader />}>
				<Content />
			</Suspense>
		</>
	);
}
