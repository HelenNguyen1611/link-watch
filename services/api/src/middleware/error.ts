import type { Context } from "hono";

type ZodLikeError = Error & { issues: unknown[] };
const isZodError = (err: Error): err is ZodLikeError =>
	err.name === "ZodError" && Array.isArray((err as ZodLikeError).issues);

/** Map errors → HTTP: Zod 400, bad JSON 400, domain errors by `code`, anything else 500 without details. */
export function onError(
	log: (message: string, extra?: Record<string, unknown>) => void,
) {
	return (err: Error, c: Context) => {
		if (isZodError(err))
			return c.json({ error: "validation", issues: err.issues }, 400);
		if (err instanceof SyntaxError)
			return c.json({ error: "invalid_json" }, 400);
		const code = (err as { code?: unknown }).code;
		if (code === "duplicate")
			return c.json(
				{
					error: "duplicate",
					message: err.message,
					...pick(err, "existingId"),
				},
				409,
			);
		if (code === "schedule_in_use")
			return c.json(
				{
					error: "schedule_in_use",
					message: err.message,
					...pick(err, "usedBy"),
				},
				409,
			);
		if (code === "default_schedule")
			return c.json({ error: "default_schedule", message: err.message }, 400);
		if (code === "import_too_large")
			return c.json({ error: "import_too_large", message: err.message }, 400);
		if (code === "incident_closed")
			return c.json({ error: "incident_closed", message: err.message }, 409);
		if (code === "not_found")
			return c.json({ error: "not_found", message: err.message }, 404);
		log("Unexpected error", { error: String(err), stack: err.stack });
		return c.json({ error: "internal" }, 500);
	};
}

const pick = (err: Error, key: string) => {
	const v = (err as unknown as Record<string, unknown>)[key];
	return v === undefined ? {} : { [key]: v };
};
