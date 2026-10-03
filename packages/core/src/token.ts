/** Server-only (node:crypto): import from "@linkwatch/core/token", never from the web app. */
import { createHash, randomBytes, randomInt } from "node:crypto";

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

/** No look-alikes (I/l/1, O/0) so a password read from an email can be typed by hand. */
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";

/**
 * FR-29: temporary password for an invitation, e.g. `Kx7m-Pq4r-Tz9w` — 12 random characters
 * (≥ 1 uppercase, lowercase and digit, User Pool policy) in groups of 4. No symbol at either
 * end, so mail apps' "Copy code" buttons copy it whole.
 */
export function newTemporaryPassword(
	pick: (max: number) => number = randomInt,
): string {
	const all = UPPER + LOWER + DIGITS;
	const chars = Array.from({ length: 12 }, () => all.charAt(pick(all.length)));
	// One of each class at distinct random positions.
	const slots = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
	for (const set of [UPPER, LOWER, DIGITS]) {
		const [slot] = slots.splice(pick(slots.length), 1);
		chars[slot ?? 0] = set.charAt(pick(set.length));
	}
	return [0, 4, 8].map((i) => chars.slice(i, i + 4).join("")).join("-");
}
