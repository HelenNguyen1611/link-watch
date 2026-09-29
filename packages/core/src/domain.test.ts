import { describe, expect, it } from "vitest";
import { rootDomainOf } from "./domain";
import { normalizeUrl } from "./url";

describe("rootDomainOf", () => {
	it("AC-01: a.abc.com/x and b.abc.com/y share domain abc.com, xyz.vn is a separate domain", () => {
		const urls = ["a.abc.com/x", "b.abc.com/y", "xyz.vn"].map((u) =>
			normalizeUrl(`https://${u}`),
		);
		const domains = urls.map(rootDomainOf);
		expect(domains).toEqual(["abc.com", "abc.com", "xyz.vn"]);
		expect(new Set(domains).size).toBe(2);
	});

	it("FR-07: uses eTLD+1 from the Public Suffix List (blog.abc.com.vn → abc.com.vn)", () => {
		expect(rootDomainOf("https://blog.abc.com.vn/")).toBe("abc.com.vn");
		expect(rootDomainOf("https://shop.abc.co.uk/x")).toBe("abc.co.uk");
	});

	it("FR-07: merges every subdomain level", () => {
		expect(rootDomainOf("https://a.b.c.abc.com/")).toBe("abc.com");
		expect(rootDomainOf("https://abc.com/")).toBe("abc.com");
	});

	it("FR-07: domains on shared platforms (github.io, vercel.app) are split per owner", () => {
		expect(rootDomainOf("https://abc.github.io/x")).toBe("abc.github.io");
		expect(rootDomainOf("https://xyz.github.io/")).toBe("xyz.github.io");
		expect(rootDomainOf("https://shop.vercel.app/")).toBe("shop.vercel.app");
	});

	it("FR-07: an IP, localhost or a bare public suffix keeps the full host", () => {
		expect(rootDomainOf("http://1.2.3.4:8080/x")).toBe("1.2.3.4");
		expect(rootDomainOf("http://[2001:db8::1]/")).toBe("[2001:db8::1]");
		expect(rootDomainOf("http://localhost:3000/")).toBe("localhost");
		expect(rootDomainOf("https://gov.vn/")).toBe("gov.vn");
	});

	it("FR-07: a Vietnamese (IDN) domain stays in punycode like the normalized URL", () => {
		expect(rootDomainOf(normalizeUrl("https://www.Tiếngviệt.vn/a"))).toBe(
			"xn--tingvit-5t4cyc.vn",
		);
	});
});
