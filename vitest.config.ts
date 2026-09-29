import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const exclude = [
	"**/node_modules/**",
	"**/cdk.out/**",
	"**/.next/**",
	"**/out/**",
];

// unit + web: chạy trong `pnpm test`, không cần Docker.
// int: chạy trong `pnpm test:int`, cần DynamoDB Local (`pnpm db:local`).
export default defineConfig({
	test: {
		projects: [
			{
				extends: true,
				test: {
					name: "unit",
					include: ["**/*.test.ts"],
					exclude: [...exclude, "**/*.int.test.ts", "apps/web/**"],
				},
			},
			{
				extends: true,
				oxc: { jsx: { runtime: "automatic" } },
				resolve: {
					alias: {
						"@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
					},
				},
				test: {
					name: "web",
					environment: "jsdom",
					setupFiles: ["apps/web/src/test/setup.ts"],
					include: ["apps/web/**/*.test.ts", "apps/web/**/*.test.tsx"],
					exclude,
				},
			},
			{
				extends: true,
				test: {
					name: "int",
					include: ["**/*.int.test.ts"],
					exclude,
					passWithNoTests: true,
				},
			},
		],
	},
});
