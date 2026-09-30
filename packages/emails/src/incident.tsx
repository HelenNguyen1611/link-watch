import { Button, Link, Section, Text } from "react-email";
import { confirmUrl, formatTime, incidentUrl } from "./format";
import { itemStyles, Layout } from "./layout";
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
		<Section style={itemStyles.item}>
			<Text style={itemStyles.url}>{item.url}</Text>
			<Text style={itemStyles.line}>
				{en.fields.type}: {en.incidentType[item.type]}
			</Text>
			{item.errorType && (
				<Text style={itemStyles.line}>
					{en.fields.error}: {en.errorType[item.errorType]}
				</Text>
			)}
			{item.httpCode !== undefined && (
				<Text style={itemStyles.line}>
					{en.fields.httpCode}: {item.httpCode}
				</Text>
			)}
			<Text style={itemStyles.line}>
				{en.fields.detectedAt}: {formatTime(item.detectedAt)}
			</Text>
			{props.extra && (
				<Text style={itemStyles.line}>
					{props.extra.label}: {props.extra.value}
				</Text>
			)}
			<Text style={itemStyles.line}>
				<Link
					href={incidentUrl(props.appUrl, item.incidentId)}
					style={itemStyles.link}
				>
					{en.fields.viewIncident}
				</Link>
			</Text>
			{item.confirmToken && (
				<Button
					href={confirmUrl(props.appUrl, item.confirmToken)}
					style={itemStyles.button}
				>
					{en.confirm.button}
				</Button>
			)}
		</Section>
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
			heading={en.incident.heading(domain)}
			intro={en.incident.intro}
		>
			{items.map((item) => (
				<IncidentItemBlock key={item.incidentId} item={item} appUrl={appUrl} />
			))}
			{groupToken && items.length > 1 && (
				<Button href={confirmUrl(appUrl, groupToken)} style={itemStyles.button}>
					{en.confirm.groupButton}
				</Button>
			)}
			{items.some((i) => i.confirmToken) && (
				<Text style={itemStyles.hint}>{en.confirm.hint}</Text>
			)}
		</Layout>
	);
}
