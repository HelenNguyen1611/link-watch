import { z } from "zod";
import { CheckErrorType, CheckResultKind } from "./enums";

/** FR-17: one check. Timestamps are ISO 8601 UTC. */
export const CheckResult = z.object({
	linkId: z.string().min(1),
	checkedAt: z.iso.datetime(),
	result: CheckResultKind,
	httpCode: z.number().int().min(100).max(599).optional(),
	responseMs: z.number().int().min(0),
	finalUrl: z.string().optional(),
	errorType: CheckErrorType.optional(),
	errorMessage: z.string().max(500).optional(),
	sslExpiresAt: z.iso.datetime().optional(),
});
export type CheckResult = z.infer<typeof CheckResult>;
