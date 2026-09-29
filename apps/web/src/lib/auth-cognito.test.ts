import { beforeEach, describe, expect, it, vi } from "vitest";

const amplify = vi.hoisted(() => ({
	configure: vi.fn(),
	signIn: vi.fn(),
	confirmSignIn: vi.fn(),
	signOut: vi.fn(),
	fetchAuthSession: vi.fn(),
	resetPassword: vi.fn(),
	confirmResetPassword: vi.fn(),
}));
vi.mock("aws-amplify", () => ({ Amplify: { configure: amplify.configure } }));
vi.mock("aws-amplify/auth", () => ({
	signIn: amplify.signIn,
	confirmSignIn: amplify.confirmSignIn,
	signOut: amplify.signOut,
	fetchAuthSession: amplify.fetchAuthSession,
	resetPassword: amplify.resetPassword,
	confirmResetPassword: amplify.confirmResetPassword,
}));

import { AuthError } from "./auth";
import { createCognitoAuth, mapCognitoError } from "./auth-cognito";

const config = {
	region: "ap-southeast-1",
	userPoolId: "ap-southeast-1_abc",
	userPoolClientId: "client123",
};
const named = (name: string, message = "") =>
	Object.assign(new Error(message), { name });
const step = (signInStep: string) => ({
	isSignedIn: signInStep === "DONE",
	nextStep: { signInStep },
});

beforeEach(() => {
	for (const fn of Object.values(amplify)) fn.mockReset();
});

describe("createCognitoAuth", () => {
	it("FR-28: configures Amplify with the User Pool and web client from /auth-config.json", () => {
		createCognitoAuth(config);
		expect(amplify.configure).toHaveBeenCalledWith({
			Auth: {
				Cognito: {
					userPoolId: "ap-southeast-1_abc",
					userPoolClientId: "client123",
					loginWith: { email: true },
				},
			},
		});
	});

	it("FR-28: sign-in maps Cognito steps (done, new password, reset required)", async () => {
		const auth = createCognitoAuth(config);
		amplify.signIn.mockResolvedValueOnce(step("DONE"));
		expect(await auth.signIn(" a@b.com ", "pw")).toEqual({ kind: "signedIn" });
		expect(amplify.signIn).toHaveBeenCalledWith({
			username: "a@b.com",
			password: "pw",
		});
		amplify.signIn.mockResolvedValueOnce(
			step("CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED"),
		);
		expect(await auth.signIn("a@b.com", "tmp")).toEqual({
			kind: "newPasswordRequired",
		});
		amplify.signIn.mockResolvedValueOnce(step("RESET_PASSWORD"));
		expect(await auth.signIn("a@b.com", "pw")).toEqual({
			kind: "resetRequired",
		});
	});

	it("a leftover session is signed out and the sign-in retried once", async () => {
		const auth = createCognitoAuth(config);
		amplify.signIn
			.mockRejectedValueOnce(named("UserAlreadyAuthenticatedException"))
			.mockResolvedValueOnce(step("DONE"));
		expect(await auth.signIn("a@b.com", "pw")).toEqual({ kind: "signedIn" });
		expect(amplify.signOut).toHaveBeenCalledTimes(1);
	});

	it("FR-28: ID token and email come from the Amplify session (refreshed by Amplify)", async () => {
		const auth = createCognitoAuth(config);
		amplify.fetchAuthSession.mockResolvedValue({
			tokens: {
				idToken: {
					toString: () => "eyJ.id.token",
					payload: { email: "a@b.com" },
				},
			},
		});
		expect(await auth.getIdToken()).toBe("eyJ.id.token");
		expect(await auth.currentUser()).toEqual({ email: "a@b.com" });
		amplify.fetchAuthSession.mockResolvedValue({ tokens: undefined });
		expect(await auth.getIdToken()).toBeNull();
		expect(await auth.currentUser()).toBeNull();
		amplify.fetchAuthSession.mockRejectedValue(new Error("refresh failed"));
		expect(await auth.getIdToken()).toBeNull();
	});

	it("FR-28: first sign-in answers the new-password challenge", async () => {
		const auth = createCognitoAuth(config);
		amplify.confirmSignIn.mockResolvedValue(step("DONE"));
		await auth.completeNewPassword("Abcdefghijk1");
		expect(amplify.confirmSignIn).toHaveBeenCalledWith({
			challengeResponse: "Abcdefghijk1",
		});
	});

	it("FR-28: forgot password sends a code, then resets with code + new password", async () => {
		const auth = createCognitoAuth(config);
		amplify.resetPassword.mockResolvedValue({});
		amplify.confirmResetPassword.mockResolvedValue(undefined);
		await auth.requestPasswordReset(" a@b.com ");
		expect(amplify.resetPassword).toHaveBeenCalledWith({ username: "a@b.com" });
		await auth.confirmPasswordReset("a@b.com", " 123456 ", "Abcdefghijk1");
		expect(amplify.confirmResetPassword).toHaveBeenCalledWith({
			username: "a@b.com",
			confirmationCode: "123456",
			newPassword: "Abcdefghijk1",
		});
	});

	it("Cognito errors become AuthError codes", async () => {
		const auth = createCognitoAuth(config);
		amplify.signIn.mockRejectedValue(
			named("NotAuthorizedException", "Incorrect username or password."),
		);
		const err = await auth.signIn("a@b.com", "x").catch((e) => e);
		expect(err).toBeInstanceOf(AuthError);
		expect(err.code).toBe("invalid_credentials");
	});
});

describe("mapCognitoError", () => {
	it.each([
		[
			"NotAuthorizedException",
			"Incorrect username or password.",
			"invalid_credentials",
		],
		["NotAuthorizedException", "User is disabled.", "user_disabled"],
		[
			"NotAuthorizedException",
			"Password attempts exceeded",
			"too_many_attempts",
		],
		["UserNotFoundException", "", "invalid_credentials"],
		["InvalidPasswordException", "", "invalid_password"],
		["CodeMismatchException", "", "code_mismatch"],
		["ExpiredCodeException", "", "code_expired"],
		["LimitExceededException", "", "too_many_attempts"],
		["NetworkError", "", "unknown"],
	])("%s (%s) → %s", (name, message, code) => {
		expect(mapCognitoError(named(name, message)).code).toBe(code);
	});
});
