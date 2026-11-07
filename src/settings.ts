import type { LinkPreviewSettings } from "./types";

export const FENCE_OPEN = "~~~link-preview";
export const FENCE_CLOSE = "~~~";
export const TIMEOUT_MS = 10000;
export const FETCH_CONCURRENCY = 3;

/** Common second-level domain parts (example.co.uk, example.com.bd). */
export const SECOND_LEVEL_TLDS = new Set([
	"co",
	"com",
	"org",
	"net",
	"gov",
	"edu",
	"ac",
	"vic",
	"nsw",
	"qc",
	"bc",
]);

export const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"];

export const DEFAULT_SETTINGS: LinkPreviewSettings = {
	autoPreview: true,
	showDescription: true,
	stripTrackers: true,
	cardLayout: "standard",
	mediaPosition: "left",
	actionPlacement: "right",
	cardRadius: "rounded",
	showFavicon: true,
	placeholderStyle: "logo-name",
	placeholderFont: "",
	glassmorphism: true,
	visibleActions: {
		copy: true,
		alias: true,
		image: true,
		refresh: true,
		open: true,
		revert: true,
	},
};
