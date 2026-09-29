import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_REDIRECTS, probe, USER_AGENT } from "./probe";
import { getCertExpiry } from "./ssl";

let base: string;
let httpsBase: string;
let server: http.Server;
let tlsServer: https.Server;
let certDir: string;
let certNotAfter: Date;
const seenUserAgents: string[] = [];
const hanging: http.ServerResponse[] = [];

function handler(req: http.IncomingMessage, res: http.ServerResponse) {
	seenUserAgents.push(String(req.headers["user-agent"]));
	const url = new URL(req.url ?? "/", "http://x");
	const send = (
		code: number,
		body = "",
		headers: Record<string, string> = {},
	) => {
		res.writeHead(code, {
			"content-type": "text/html; charset=utf-8",
			...headers,
		});
		res.end(req.method === "HEAD" ? undefined : body);
	};
	switch (url.pathname) {
		case "/ok":
			return send(200, "<h1>Xin chào</h1><a href='/lien-he'>Liên hệ</a>");
		case "/404":
			return send(404, "not found");
		case "/503":
			return send(503, "maintenance");
		case "/redirect":
			return send(301, "", { location: "/ok" });
		case "/loop": {
			const n = Number(url.searchParams.get("n") ?? 0);
			return send(302, "", { location: `/loop?n=${n + 1}` });
		}
		case "/redirect-n": {
			const left = Number(url.searchParams.get("left"));
			return left > 0
				? send(302, "", { location: `/redirect-n?left=${left - 1}` })
				: send(200, "final");
		}
		case "/to-private":
			return send(302, "", {
				location: "http://169.254.169.254/latest/meta-data/",
			});
		case "/to-ftp":
			return send(302, "", { location: "ftp://abc.com/file" });
		case "/head405":
			return req.method === "HEAD" ? send(405) : send(200, "GET only");
		case "/slow":
			return setTimeout(() => send(200, "slow"), 300);
		case "/hang":
			hanging.push(res);
			return;
		case "/big":
			res.writeHead(200, { "content-type": "text/plain" });
			res.write("a".repeat(2 * 1024 * 1024));
			return res.end("END-KEYWORD");
		default:
			return send(404);
	}
}

beforeAll(async () => {
	server = http.createServer(handler);
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

	certDir = mkdtempSync(join(tmpdir(), "lw-cert-"));
	execFileSync(
		"openssl",
		[
			"req",
			"-x509",
			"-newkey",
			"rsa:2048",
			"-nodes",
			"-days",
			"30",
			"-subj",
			"/CN=localhost",
			"-keyout",
			join(certDir, "key.pem"),
			"-out",
			join(certDir, "cert.pem"),
		],
		{ stdio: "ignore" },
	);
	const endDate = execFileSync("openssl", [
		"x509",
		"-enddate",
		"-noout",
		"-in",
		join(certDir, "cert.pem"),
	]).toString();
	certNotAfter = new Date(endDate.replace("notAfter=", "").trim());
	tlsServer = https.createServer(
		{
			key: readFileSync(join(certDir, "key.pem")),
			cert: readFileSync(join(certDir, "cert.pem")),
		},
		handler,
	);
	await new Promise<void>((r) => tlsServer.listen(0, "127.0.0.1", r));
	httpsBase = `https://127.0.0.1:${(tlsServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
	for (const res of hanging) res.destroy();
	await new Promise((r) => server.close(r));
	await new Promise((r) => tlsServer.close(r));
	rmSync(certDir, { recursive: true, force: true });
});

// The test server runs on 127.0.0.1, so allowPrivate must be on (admin override, NFR-07).
const local = { allowPrivate: true };
const link = (
	path: string,
	extra: Partial<Parameters<typeof probe>[0]> = {},
) => ({
	url: `${base}${path}`,
	method: "GET" as const,
	timeoutS: 5,
	...extra,
});

describe("probe", () => {
	it("FR-17: 200 → HTTP code, response time, final URL", async () => {
		const r = await probe(link("/ok"), local);
		expect(r).toMatchObject({
			httpCode: 200,
			finalUrl: `${base}/ok`,
			redirectCount: 0,
		});
		expect(r.error).toBeUndefined();
		expect(r.responseMs).toBeGreaterThanOrEqual(0);
	});

	it("5.1: sends User-Agent LinkWatch/1.0", async () => {
		seenUserAgents.length = 0;
		await probe(link("/ok"), local);
		expect(USER_AGENT).toBe("LinkWatch/1.0");
		expect(seenUserAgents).toEqual(["LinkWatch/1.0"]);
	});

	it("FR-17: 404 and 503 return HTTP codes, not network errors", async () => {
		expect(await probe(link("/404"), local)).toMatchObject({ httpCode: 404 });
		expect(await probe(link("/503"), local)).toMatchObject({ httpCode: 503 });
	});

	it("5.1: follows 301 → 200, records the final URL and redirect count", async () => {
		expect(await probe(link("/redirect"), local)).toMatchObject({
			httpCode: 200,
			finalUrl: `${base}/ok`,
			redirectCount: 1,
		});
	});

	it("5.1: exactly 10 redirects is fine, a redirect loop beyond 10 → TOO_MANY_REDIRECTS", async () => {
		expect(MAX_REDIRECTS).toBe(10);
		expect(await probe(link("/redirect-n?left=10"), local)).toMatchObject({
			httpCode: 200,
			redirectCount: 10,
		});
		const r = await probe(link("/loop"), local);
		expect(r.error?.code).toBe("TOO_MANY_REDIRECTS");
		expect(r.redirectCount).toBe(11);
	});

	it("5.1: HEAD answered with 405 is retried with GET", async () => {
		expect(
			await probe(link("/head405", { method: "HEAD" }), local),
		).toMatchObject({ httpCode: 200 });
	});

	it("FR-01: HEAD without 405 stays HEAD", async () => {
		expect(await probe(link("/404", { method: "HEAD" }), local)).toMatchObject({
			httpCode: 404,
		});
	});

	it("5.1: measures the response time of a slow page", async () => {
		const r = await probe(link("/slow"), local);
		expect(r.httpCode).toBe(200);
		expect(r.responseMs).toBeGreaterThanOrEqual(280);
	});

	it("5.1: no response within the timeout → timeout error", async () => {
		const r = await probe(link("/hang", { timeoutS: 1 }), local);
		expect(r.error?.code).toBe("TimeoutError");
		expect(r.responseMs).toBeGreaterThanOrEqual(950);
		expect(r.responseMs).toBeLessThan(3000);
	});

	it("5.1: connection refused → ECONNREFUSED", async () => {
		const r = await probe(
			{ url: "http://127.0.0.1:1/", method: "GET", timeoutS: 5 },
			local,
		);
		expect(r.error?.code).toBe("ECONNREFUSED");
	});

	it("5.1: DNS does not resolve → ENOTFOUND", async () => {
		const r = await probe(
			{ url: "http://does-not-exist.invalid/", method: "GET", timeoutS: 5 },
			local,
		);
		expect(r.error?.code).toBe("ENOTFOUND");
	});

	it("5.1: self-signed certificate → SSL error, certificate expiry still read", async () => {
		const r = await probe(
			{ url: `${httpsBase}/ok`, method: "GET", timeoutS: 5 },
			local,
		);
		expect(r.error?.code).toMatch(/SELF_SIGNED|DEPTH_ZERO|UNABLE_TO_VERIFY/);
		expect(r.sslExpiresAt).toBe(certNotAfter.toISOString());
	});

	it("FR-01: required keyword → keywordFound", async () => {
		expect(
			await probe(link("/ok", { keyword: "Liên hệ" }), local),
		).toMatchObject({ keywordFound: true });
		expect(
			await probe(link("/ok", { keyword: "Not on the page" }), local),
		).toMatchObject({ keywordFound: false });
	});

	it("FR-01: keyword matching is case-insensitive ('LIÊN HỆ' entered, page says 'Liên hệ')", async () => {
		expect(
			await probe(link("/ok", { keyword: "LIÊN HỆ" }), local),
		).toMatchObject({ keywordFound: true });
	});

	it("FR-01: a HEAD link with a keyword uses GET to read the body", async () => {
		expect(
			await probe(link("/ok", { method: "HEAD", keyword: "Liên hệ" }), local),
		).toMatchObject({
			keywordFound: true,
		});
	});

	it("NFR-09: reads at most 1 MB of the body when searching for the keyword", async () => {
		const r = await probe(link("/big", { keyword: "END-KEYWORD" }), local);
		expect(r).toMatchObject({ httpCode: 200, keywordFound: false });
	});

	it("FR-17: without a keyword, keywordFound is not set", async () => {
		expect((await probe(link("/ok"), local)).keywordFound).toBeUndefined();
	});
});

describe("probe — SSRF blocking (NFR-07)", () => {
	it("NFR-07: private IPs are blocked by default and no request is sent", async () => {
		seenUserAgents.length = 0;
		const r = await probe(link("/ok"));
		expect(r.error?.code).toBe("BLOCKED_PRIVATE_ADDRESS");
		expect(seenUserAgents).toEqual([]);
	});

	it("NFR-07: blocks hostnames resolving to private IPs (localhost)", async () => {
		const port = new URL(base).port;
		const r = await probe({
			url: `http://localhost:${port}/ok`,
			method: "GET",
			timeoutS: 5,
		});
		expect(r.error?.code).toBe("BLOCKED_PRIVATE_ADDRESS");
	});

	it("NFR-07: blocks a redirect to the metadata address even when the first page is allowed", async () => {
		const r = await probe(link("/to-private"), {
			allowPrivate: false,
			allowHosts: ["127.0.0.1"],
		});
		expect(r.error?.code).toBe("BLOCKED_PRIVATE_ADDRESS");
		expect(r.redirectCount).toBe(1);
	});

	it("FR-01: a redirect to a non-http/https scheme is an error", async () => {
		const r = await probe(link("/to-ftp"), local);
		expect(r.error?.code).toBe("UNSUPPORTED_REDIRECT");
	});
});

describe("getCertExpiry", () => {
	it("FR-17: reads the SSL certificate expiry", async () => {
		const port = Number(new URL(httpsBase).port);
		expect(
			(
				await getCertExpiry("127.0.0.1", port, { allowPrivate: true })
			)?.toISOString(),
		).toBe(certNotAfter.toISOString());
	});

	it("FR-17: returns undefined without throwing when it cannot connect", async () => {
		expect(
			await getCertExpiry("127.0.0.1", 1, { allowPrivate: true }),
		).toBeUndefined();
	});
});
