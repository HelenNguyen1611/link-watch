import { roleFromGroups } from "@linkwatch/core";
import { Amplify } from "aws-amplify";
import {
	confirmResetPassword,
	confirmSignIn,
	fetchAuthSession,
	resetPassword,
	signIn,
	signOut,
} from "aws-amplify/auth";
import {
	type AuthClient,
	type AuthConfig,
	AuthError,
	type AuthErrorCode,
	type SignInResult,
} from "./auth";

/** Cognito exception name → message shown to the user. */
export function mapCognitoError(err: unknown): AuthError {
	const name = (err as { name?: string } | null)?.name ?? "";
	const message = (err as { message?: string } | null)?.message ?? "";
	const code: AuthErrorCode = (() => {
		switch (name) {
			case "NotAuthorizedException":
				return /disabled/i.test(message)
					? "user_disabled"
					: /attempts exceeded/i.test(message)
						? "too_many_attempts"
						: "invalid_credentials";
			case "UserNotFoundException":
				return "invalid_credentials";
			case "InvalidPasswordException":
				return "invalid_password";
			case "CodeMismatchException":
				return "code_mismatch";
			case "ExpiredCodeException":
				return "code_expired";
			case "LimitExceededException":
			case "TooManyRequestsException":
			case "TooManyFailedAttemptsException":
				return "too_many_attempts";
			default:
				return "unknown";
		}
	})();
	return new AuthError(code, err);
}

const toResult = (step: string): SignInResult => {
	if (step === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED")
		return { kind: "newPasswordRequired" };
	if (step === "RESET_PASSWORD") return { kind: "resetRequired" };
	if (step === "DONE") return { kind: "signedIn" };
	// MFA and other challenges are off in the User Pool (infra/lib/api-stack.ts).
	throw new AuthError("unknown", new Error(`Unsupported sign-in step ${step}`));
};

async function run<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (err) {
		throw err instanceof AuthError ? err : mapCognitoError(err);
	}
}

/**
 * FR-28 production sign-in: SRP against the `linkwatch-web` client (the password never
 * leaves the browser in clear). Amplify keeps the tokens and refreshes the 1-hour ID token
 * with the 30-day refresh token.
 */
export function createCognitoAuth(config: AuthConfig): AuthClient {
	Amplify.configure({
		Auth: {
			Cognito: {
				userPoolId: config.userPoolId,
				userPoolClientId: config.userPoolClientId,
				loginWith: { email: true },
			},
		},
	});

	const idToken = async () => {
		try {
			return (await fetchAuthSession()).tokens?.idToken;
		} catch {
			return undefined;
		}
	};

	return {
		async currentUser() {
			const payload = (await idToken())?.payload;
			const email = payload?.email;
			return typeof email === "string"
				? { email, role: roleFromGroups(payload?.["cognito:groups"]) }
				: null;
		},
		async getIdToken() {
			return (await idToken())?.toString() ?? null;
		},
		signIn: (email, password) =>
			run(async () => {
				const attempt = () => signIn({ username: email.trim(), password });
				try {
					return toResult((await attempt()).nextStep.signInStep);
				} catch (err) {
					// A stale session from another user: sign out and try once more.
					if (
						(err as { name?: string }).name !==
						"UserAlreadyAuthenticatedException"
					)
						throw err;
					await signOut();
					return toResult((await attempt()).nextStep.signInStep);
				}
			}),
		completeNewPassword: (newPassword) =>
			run(async () => {
				const res = await confirmSignIn({ challengeResponse: newPassword });
				if (toResult(res.nextStep.signInStep).kind !== "signedIn")
					throw new AuthError("unknown");
			}),
		requestPasswordReset: (email) =>
			run(async () => {
				await resetPassword({ username: email.trim() });
			}),
		confirmPasswordReset: (email, code, newPassword) =>
			run(() =>
				confirmResetPassword({
					username: email.trim(),
					confirmationCode: code.trim(),
					newPassword,
				}),
			),
		signOut: () => run(() => signOut()),
	};
}
