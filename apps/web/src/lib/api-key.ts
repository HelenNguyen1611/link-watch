/**
 * TEMPORARY (milestone 1, removed in step 23b with Cognito sign-in):
 * API key entered by the user and stored in browser localStorage.
 * Never baked into the bundle: static files on CloudFront are public.
 */
const STORAGE_KEY = "linkwatch.apiKey";

const storage = () => {
	try {
		return typeof window === "undefined" ? null : window.localStorage;
	} catch {
		return null;
	}
};

export function getApiKey(): string | null {
	const v = storage()?.getItem(STORAGE_KEY)?.trim();
	return v ? v : null;
}

export function setApiKey(key: string): void {
	storage()?.setItem(STORAGE_KEY, key.trim());
}

export function clearApiKey(): void {
	storage()?.removeItem(STORAGE_KEY);
}
