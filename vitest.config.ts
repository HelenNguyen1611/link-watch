import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const exclude = [
	"**/node_modules/**",
	"**/cdk.out/**",
	"**/.next/**",
	"**/out/**",
];

// unit + web: run by `pnpm test`, no Docker needed.
// int: run by `pnpm test:int`, needs DynamoDB Local (`pnpm db:local`).
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
					// jsdom renders of full tables (e.g. 50 rows per page) take ~2 s with the whole suite on a
					// laptop and exceed the 5 s default on the 2-vCPU GitHub runner.
					testTimeout: 15_000,
				},
			},
			{
				extends: true,
				test: {
					name: "int",
					include: ["**/*.int.test.ts"],
					exclude,
					passWithNoTests: true,
					// Every int file shares one DynamoDB Local; under parallel load a single test can exceed 5 s.
					testTimeout: 20_000,
				},
			},
		],
	},
});
