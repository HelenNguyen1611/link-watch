import { GetParameterCommand, type SSMClient } from "@aws-sdk/client-ssm";

/** Đọc lại khóa sau 5 phút để đổi khóa trên SSM không cần deploy. */
export const SECRET_TTL_MS = 5 * 60_000;

/** TẠM THỜI (xóa ở Bước 18b): đọc khóa API từ SSM SecureString, cache trong bộ nhớ Lambda. */
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
