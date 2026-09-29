"use client";

import { Alert, Center, Loader } from "@mantine/core";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { loginUrl } from "@/lib/auth";
import { useAuth } from "@/lib/auth-context";
import { PALETTE } from "@/lib/colors";

/** FR-28: renders the page only for a signed-in user; otherwise goes to /login/?next=<this page>. */
export function AuthGate({ children }: { children: ReactNode }) {
	const { t } = useTranslation();
	const { status } = useAuth();
	const router = useRouter();
	const pathname = usePathname() ?? "/";

	useEffect(() => {
		if (status === "signedOut")
			router.replace(loginUrl(`${pathname}${window.location.search}`));
	}, [status, pathname, router]);

	if (status === "signedIn") return <>{children}</>;
	if (status === "unconfigured")
		return (
			<Alert color={PALETTE.danger} variant="light">
				{t("auth.unconfigured")}
			</Alert>
		);
	return (
		<Center py="xl" role="status" aria-label={t("auth.checking")}>
			<Loader size="sm" />
		</Center>
	);
}
