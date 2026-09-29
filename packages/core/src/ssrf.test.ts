import { describe, expect, it } from "vitest";
import { isForbiddenHostname, isPrivateIp, parseIp } from "./ssrf";

describe("isPrivateIp", () => {
	it.each([
		"127.0.0.1",
		"127.255.255.254",
		"10.0.0.1",
		"10.255.255.255",
		"172.16.0.1",
		"172.31.255.255",
		"192.168.1.1",
		"169.254.169.254",
		"169.254.0.1",
		"100.64.0.1",
		"0.0.0.0",
		"0.1.2.3",
		"192.0.0.8",
		"192.0.2.10",
		"198.18.0.1",
		"198.51.100.7",
		"203.0.113.9",
		"224.0.0.1",
		"240.0.0.1",
		"255.255.255.255",
	])("NFR-07: blocks private/special IPv4 %s", (ip) => {
		expect(isPrivateIp(ip)).toBe(true);
	});

	it.each([
		"1.1.1.1",
		"8.8.8.8",
		"172.15.255.255",
		"172.32.0.1",
		"100.63.255.255",
		"100.128.0.1",
		"169.253.255.255",
		"13.228.1.1",
	])("NFR-07: allows public IPv4 %s", (ip) => {
		expect(isPrivateIp(ip)).toBe(false);
	});

	it.each([
		"::",
		"::1",
		"fc00::1",
		"fd12:3456::1",
		"fe80::1",
		"febf::1",
		"ff02::1",
		"2001:db8::1",
		"::ffff:127.0.0.1",
		"::ffff:7f00:1",
		"::ffff:169.254.169.254",
		"64:ff9b::a9fe:a9fe",
		"fd00:ec2::254",
	])("NFR-07: blocks private/special IPv6 %s", (ip) => {
		expect(isPrivateIp(ip)).toBe(true);
	});

	it.each([
		"2606:4700:4700::1111",
		"2001:4860:4860::8888",
		"::ffff:8.8.8.8",
		"2404:6800:4003:c00::64",
	])("NFR-07: allows public IPv6 %s", (ip) => {
		expect(isPrivateIp(ip)).toBe(false);
	});

	it("NFR-07: accepts bracketed IPv6 as in a URL", () => {
		expect(isPrivateIp("[::1]")).toBe(true);
	});

	it("non-IP strings parse to null and throw when checked", () => {
		expect(parseIp("abc.com")).toBeNull();
		expect(parseIp("256.1.1.1")).toBeNull();
		expect(parseIp("1.2.3")).toBeNull();
		expect(parseIp("1::2::3")).toBeNull();
		expect(() => isPrivateIp("abc.com")).toThrow();
	});
});

describe("isForbiddenHostname", () => {
	it.each([
		"localhost",
		"LOCALHOST",
		"app.localhost",
		"metadata.google.internal",
		"ip-10-0-0-1.ec2.internal",
		"printer.local",
		"127.0.0.1",
		"[::1]",
		"10.1.2.3",
	])("NFR-07: blocks internal hostname %s", (host) => {
		expect(isForbiddenHostname(host)).toBe(true);
	});

	it.each([
		"abc.com",
		"localhost.abc.com",
		"8.8.8.8",
		"[2606:4700:4700::1111]",
	])("NFR-07: allows public hostname %s", (host) => {
		expect(isForbiddenHostname(host)).toBe(false);
	});
});
