import { defineConfig, devices } from "@playwright/test";

const PORT = 4310;

/** Step 34: E2E of SCR-10 on a phone viewport (NFR-10). Needs `pnpm db:local` and a web build. */
export default defineConfig({
	testDir: "e2e",
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: 0,
	reporter: "list",
	use: {
		baseURL: `http://localhost:${PORT}`,
		trace: "retain-on-failure",
	},
	projects: [{ name: "mobile", use: { ...devices["Pixel 7"] } }],
	webServer: {
		command: "pnpm -w exec tsx tests/e2e/server.ts",
		url: `http://localhost:${PORT}/api/health`,
		reuseExistingServer: false,
		timeout: 60_000,
		env: { E2E_PORT: String(PORT) },
	},
});
