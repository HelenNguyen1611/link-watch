import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { createSecretLoader, SECRET_TTL_MS } from "./secret";

const ssmMock = mockClient(SSMClient);
beforeEach(() => {
	ssmMock.reset();
	ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: "khoa-1" } });
});

describe("createSecretLoader", () => {
	it("NFR-07 (tạm): đọc SecureString có giải mã", async () => {
		const load = createSecretLoader({
			ssm: new SSMClient({}),
			name: "/linkwatch/api-shared-secret",
		});
		expect(await load()).toBe("khoa-1");
		expect(ssmMock.commandCalls(GetParameterCommand)[0].args[0].input).toEqual({
			Name: "/linkwatch/api-shared-secret",
			WithDecryption: true,
		});
	});

	it("cache 5 phút rồi đọc lại (đổi khóa không cần deploy)", async () => {
		expect(SECRET_TTL_MS).toBe(5 * 60_000);
		let now = 0;
		const load = createSecretLoader({
			ssm: new SSMClient({}),
			name: "n",
			now: () => now,
		});
		await load();
		now = SECRET_TTL_MS - 1;
		await load();
		expect(ssmMock.commandCalls(GetParameterCommand)).toHaveLength(1);
		ssmMock
			.on(GetParameterCommand)
			.resolves({ Parameter: { Value: "khoa-2" } });
		now = SECRET_TTL_MS;
		expect(await load()).toBe("khoa-2");
	});

	it("đọc SSM lỗi thì ném lỗi (API trả 500, không cho qua)", async () => {
		ssmMock.on(GetParameterCommand).rejects(new Error("AccessDenied"));
		const load = createSecretLoader({ ssm: new SSMClient({}), name: "n" });
		await expect(load()).rejects.toThrow("AccessDenied");
	});
});
