import { confirmUrl, formatTime, incidentUrl } from "./format";
import {
	Details,
	Hint,
	ItemCard,
	Layout,
	PrimaryButton,
	TextLink,
} from "./layout";
import { en } from "./strings";
import type { IncidentEmailProps, IncidentItem } from "./types";

/** FR-24: URL, error type, HTTP code, detection time and a link to the incident page. */
export function IncidentItemBlock(props: {
	item: IncidentItem;
	appUrl: string;
	extra?: { label: string; value: string };
}) {
	const { item } = props;
	return (
		<ItemCard tone="danger" url={item.url}>
			<Details
				rows={[
					[en.fields.type, en.incidentType[item.type]],
					!!item.errorType && [en.fields.error, en.errorType[item.errorType]],
					item.httpCode !== undefined && [
						en.fields.httpCode,
						String(item.httpCode),
					],
					[en.fields.detectedAt, formatTime(item.detectedAt)],
					props.extra && [props.extra.label, props.extra.value],
				]}
			/>
			{item.confirmToken && (
				<PrimaryButton href={confirmUrl(props.appUrl, item.confirmToken)}>
					{en.confirm.button}
				</PrimaryButton>
			)}
			<p style={{ margin: "8px 0 0" }}>
				<TextLink href={incidentUrl(props.appUrl, item.incidentId)}>
					{en.fields.viewIncident}
				</TextLink>
			</p>
		</ItemCard>
	);
}

/** FR-21, FR-22: incident email, one block per failing link of the domain. */
export function IncidentEmail({
	domain,
	items,
	appUrl,
	groupToken,
}: IncidentEmailProps) {
	return (
		<Layout
			preview={en.incident.preview(domain, items.length)}
			tone="danger"
			badge={en.incident.badge}
			heading={en.incident.heading(domain)}
			intro={en.incident.intro}
			appUrl={appUrl}
			footer={en.footer.alert}
		>
			{items.map((item) => (
				<IncidentItemBlock key={item.incidentId} item={item} appUrl={appUrl} />
			))}
			{groupToken && items.length > 1 && (
				<PrimaryButton href={confirmUrl(appUrl, groupToken)}>
					{en.confirm.groupButton}
				</PrimaryButton>
			)}
			{items.some((i) => i.confirmToken) && <Hint>{en.confirm.hint}</Hint>}
		</Layout>
	);
}
