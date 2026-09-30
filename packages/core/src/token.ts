/** Server-only (node:crypto): import from "@linkwatch/core/token", never from the web app. */
import { createHash, randomBytes } from "node:crypto";

/** FR-34: token lifetime (also invalid as soon as the incident closes). */
export const TOKEN_TTL_DAYS = 7;

/** FR-34: 256 random bits, URL-safe. Only its hash is stored. */
export function newToken(): string {
	return randomBytes(32).toString("base64url");
}

export const hashToken = (token: string) =>
	createHash("sha256").update(token).digest("hex");

/** Epoch seconds at which DynamoDB TTL deletes the token record. */
export function tokenTtl(issuedAt: Date): number {
	return Math.floor(issuedAt.getTime() / 1000) + TOKEN_TTL_DAYS * 86_400;
}

export function isTokenExpired(ttl: number, now: Date): boolean {
	return now.getTime() / 1000 >= ttl;
}
