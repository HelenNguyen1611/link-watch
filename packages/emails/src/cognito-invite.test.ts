import { describe, expect, it } from "vitest";
import {
	COGNITO_CODE,
	COGNITO_EMAIL_MAX_LENGTH,
	COGNITO_USERNAME,
	cognitoInviteEmail,
} from "./cognito-invite";

const email = cognitoInviteEmail({
	appUrl: "https://watch.hueai.net/",
	validityDays: 7,
	senderAddress: "no-reply@verificationemail.com",
});

describe("cognitoInviteEmail — FR-29", () => {
	it("FR-29: keeps both Cognito placeholders exactly once (required by the User Pool)", () => {
		expect(email.html.split(COGNITO_USERNAME)).toHaveLength(2);
		expect(email.html.split(COGNITO_CODE)).toHaveLength(2);
	});

	it("FR-29: fits Cognito's message size limit", () => {
		expect(email.html.length).toBeLessThan(COGNITO_EMAIL_MAX_LENGTH);
	});

	it("FR-29: names the product, the sign-in page, the steps and the expiry", () => {
		expect(email.subject).toBe(
			"Your LinkWatch invitation and temporary password",
		);
		expect(email.html).toContain('href="https://watch.hueai.net/login/"');
		expect(email.html).toContain("You have been invited to LinkWatch");
		expect(email.html).toContain("What to do");
		expect(email.html).toContain("expires in 7 days");
		expect(email.html).toContain("at least 12 characters");
	});

	it("FR-29: tells the recipient who sends it and how to spot a fake", () => {
		expect(email.html).toContain("no-reply@verificationemail.com");
		expect(email.html).toContain("Amazon Cognito");
		expect(email.html).toContain("never asks for your password");
		expect(email.html).toContain("You can ignore this email");
	});

	it("FR-29: warns that 'Copy code' buttons can drop a leading symbol", () => {
		expect(email.html).toContain("including any symbol at the start or end");
	});

	it("FR-29: singular day when the validity is 1 day", () => {
		expect(
			cognitoInviteEmail({
				appUrl: "https://x.test",
				validityDays: 1,
				senderAddress: "a@b.c",
			}).html,
		).toContain("expires in 1 day<");
	});
});
