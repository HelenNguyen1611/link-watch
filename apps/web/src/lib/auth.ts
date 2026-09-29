import { z } from "zod";

/**
 * FR-28: sign-in with email + password (Cognito User Pool). Two implementations share this
 * interface: `createCognitoAuth` (production, Amplify) and `createLocalAuth` (`next dev` only).
 */
export type AuthUser = { email: string };

export type SignInResult =
	| { kind: "signedIn" }
	/** First sign-in with the temporary password from the invitation email. */
	| { kind: "newPasswordRequired" }
	/** An admin reset the password: a code was emailed, continue with `confirmPasswordReset`. */
	| { kind: "resetRequired" };

export interface AuthClient {
	/** Signed-in user, or null. */
	currentUser(): Promise<AuthUser | null>;
	/** ID token for `Authorization: Bearer …`, refreshed automatically; null when signed out. */
	getIdToken(): Promise<string | null>;
	signIn(email: string, password: string): Promise<SignInResult>;
	/** Answers the `newPasswordRequired` step of the current sign-in. */
	completeNewPassword(newPassword: string): Promise<void>;
	/** Forgot password: emails a verification code. */
	requestPasswordReset(email: string): Promise<void>;
	confirmPasswordReset(
		email: string,
		code: string,
		newPassword: string,
	): Promise<void>;
	signOut(): Promise<void>;
}

/** Error codes shown to the user (translated as `auth.errors.<code>`). */
export const AUTH_ERROR_CODES = [
	"invalid_credentials",
	"user_disabled",
	"invalid_password",
	"code_mismatch",
	"code_expired",
	"too_many_attempts",
	"unknown",
] as const;
export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

export class AuthError extends Error {
	constructor(
		readonly code: AuthErrorCode,
		cause?: unknown,
	) {
		super(`Auth error: ${code}`, { cause });
		this.name = "AuthError";
	}
}

export const authErrorCode = (err: unknown): AuthErrorCode =>
	err instanceof AuthError ? err.code : "unknown";

/** Fired by the API client on 401 so the app goes back to the sign-in page. */
export const UNAUTHORIZED_EVENT = "linkwatch:unauthorized";
export const notifyUnauthorized = () => {
	if (typeof window !== "undefined")
		window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
};

/** Pages that open without signing in: sign-in itself and the emailed "Fixed" link (SCR-10). */
export const PUBLIC_PATHS = ["/login/", "/confirm/"] as const;
export const LOGIN_PATH = "/login/";

export function isPublicPath(pathname: string): boolean {
	const path = pathname.endsWith("/") ? pathname : `${pathname}/`;
	return PUBLIC_PATHS.some((p) => path === p);
}

/**
 * Where to go after signing in. Only same-site paths are accepted (`/links/?x=1`),
 * so a crafted `?next=https://evil.com` or `//evil.com` cannot redirect off the site.
 */
export function safeNext(next: string | null | undefined): string {
	if (!next?.startsWith("/") || next.startsWith("//")) return "/";
	if (next.includes("\\")) return "/";
	if (isPublicPath(next.split(/[?#]/)[0] ?? "")) return "/";
	return next;
}

export const loginUrl = (next: string) =>
	`${LOGIN_PATH}?next=${encodeURIComponent(next)}`;

/** Same rules as the User Pool password policy (infra/lib/api-stack.ts). */
export const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_RULES = [
	["too_short", (p: string) => p.length >= PASSWORD_MIN_LENGTH],
	["no_lowercase", (p: string) => /[a-z]/.test(p)],
	["no_uppercase", (p: string) => /[A-Z]/.test(p)],
	["no_digit", (p: string) => /\d/.test(p)],
] as const;
export type PasswordRule = (typeof PASSWORD_RULES)[number][0];
export const PASSWORD_RULE_CODES: readonly PasswordRule[] = PASSWORD_RULES.map(
	([code]) => code,
);

/** Rules the password does not meet yet, in display order (empty = valid). */
export const unmetPasswordRules = (password: string): PasswordRule[] =>
	PASSWORD_RULES.filter(([, ok]) => !ok(password)).map(([code]) => code);

/**
 * New password + confirmation. The issue message is the error code
 * (translated as `auth.fieldErrors.<code>`), also in `params.code` like `LinkInput`.
 */
export function refineNewPassword(
	v: { password: string; confirm: string },
	ctx: z.RefinementCtx,
): void {
	const [first] = unmetPasswordRules(v.password);
	if (first)
		ctx.addIssue({
			code: "custom",
			path: ["password"],
			message: first,
			params: { code: first },
		});
	if (v.password !== v.confirm)
		ctx.addIssue({
			code: "custom",
			path: ["confirm"],
			message: "mismatch",
			params: { code: "mismatch" },
		});
}

export const newPasswordSchema = z
	.object({ password: z.string(), confirm: z.string() })
	.superRefine(refineNewPassword);

/** `/auth-config.json`, written to S3 by the web stack at deploy time (infra/lib/web-stack.ts). */
export const AuthConfig = z.object({
	region: z.string().min(1),
	userPoolId: z.string().min(1),
	userPoolClientId: z.string().min(1),
});
export type AuthConfig = z.infer<typeof AuthConfig>;

export type AuthSetup =
	| { kind: "cognito"; config: AuthConfig }
	/** `next dev` without a User Pool: any email signs in, the local API accepts any bearer. */
	| { kind: "local" }
	/** Production build without `/auth-config.json`: never falls back to the fake sign-in. */
	| { kind: "unconfigured" };

/** Reads `/auth-config.json`; the local fake sign-in is only allowed in development. */
export async function loadAuthSetup(opts: {
	fetch: typeof fetch;
	dev: boolean;
}): Promise<AuthSetup> {
	try {
		const res = await opts.fetch("/auth-config.json", { cache: "no-store" });
		if (res.ok) {
			const parsed = AuthConfig.safeParse(await res.json());
			if (parsed.success) return { kind: "cognito", config: parsed.data };
		}
	} catch {
		// Missing or unreadable config: handled below.
	}
	return opts.dev ? { kind: "local" } : { kind: "unconfigured" };
}
