import { defineConfig } from "vitest/config";

const exclude = [
	"**/node_modules/**",
	"**/cdk.out/**",
	"**/.next/**",
	"**/out/**",
];

// unit: chạy trong `pnpm test`, không cần Docker.
// int: chạy trong `pnpm test:int`, cần DynamoDB Local (`pnpm db:local`).
export default defineConfig({
	test: {
		projects: [
			{
				extends: true,
				test: {
					name: "unit",
					include: ["**/*.test.ts", "**/*.test.tsx"],
					exclude: [...exclude, "**/*.int.test.ts"],
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
