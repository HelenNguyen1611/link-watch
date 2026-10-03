import { formatDuration, formatTime, incidentUrl } from "./format";
import { Details, ItemCard, Layout, TextLink } from "./layout";
import { en } from "./strings";
import type { RecoveryEmailProps } from "./types";

/** FR-21: recovery email with the downtime of each link (AC-07). */
export function RecoveryEmail({ domain, items, appUrl }: RecoveryEmailProps) {
	return (
		<Layout
			preview={en.recovery.preview(domain, items.length)}
			tone="success"
			badge={en.recovery.badge}
			heading={en.recovery.heading(domain)}
			intro={en.recovery.intro}
			appUrl={appUrl}
			footer={en.footer.alert}
		>
			{items.map((item) => (
				<ItemCard key={item.incidentId} tone="success" url={item.url}>
					<Details
						rows={[
							[en.fields.downtime, formatDuration(item.downtimeMs)],
							[en.fields.recoveredAt, formatTime(item.recoveredAt)],
							!!item.fixedBy && [en.fixedBy, item.fixedBy],
						]}
					/>
					<p style={{ margin: "8px 0 0" }}>
						<TextLink href={incidentUrl(appUrl, item.incidentId)}>
							{en.fields.viewIncident}
						</TextLink>
					</p>
				</ItemCard>
			))}
		</Layout>
	);
}
