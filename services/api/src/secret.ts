import { GetParameterCommand, type SSMClient } from "@aws-sdk/client-ssm";

/** Re-read the key after 5 minutes so rotating it in SSM needs no deploy. */
export const SECRET_TTL_MS = 5 * 60_000;

/** TEMPORARY (removed in step 18b): reads the API key from an SSM SecureString, cached in Lambda memory. */
export function createSecretLoader(opts: {
	ssm: SSMClient;
	name: string;
	now?: () => number;
}) {
	const now = opts.now ?? Date.now;
	let cached: { value: string; at: number } | undefined;
	return async function load(): Promise<string> {
		if (cached && now() - cached.at < SECRET_TTL_MS) return cached.value;
		const res = await opts.ssm.send(
			new GetParameterCommand({ Name: opts.name, WithDecryption: true }),
		);
		cached = { value: res.Parameter?.Value ?? "", at: now() };
		return cached.value;
	};
}
