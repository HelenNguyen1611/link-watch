import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom thiếu các API mà Mantine dùng.
Object.defineProperty(window, "matchMedia", {
	writable: true,
	value: (query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: () => {},
		removeListener: () => {},
		addEventListener: () => {},
		removeEventListener: () => {},
		dispatchEvent: () => false,
	}),
});
class ResizeObserverStub {
	observe() {}
	unobserve() {}
	disconnect() {}
}
window.ResizeObserver ??=
	ResizeObserverStub as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};
window.HTMLElement.prototype.scrollIntoView ??= () => {};

afterEach(() => cleanup());
