import type { Editor, TFile } from "obsidian";

export type CardLayout = "standard" | "banner" | "compact";
export type MediaPosition = "left" | "right";
export type ActionPlacement = "right" | "space-between" | "space-evenly" | "left";
export type CardRadius = "rounded" | "sharp" | "pill";
export type PlaceholderStyle = "logo-name" | "icon-and-name";

export interface VisibleActions {
	copy: boolean;
	alias: boolean;
	image: boolean;
	refresh: boolean;
	open: boolean;
	revert: boolean;
}

export interface LinkPreviewSettings {
	autoPreview: boolean;
	showDescription: boolean;
	stripTrackers: boolean;
	cardLayout: CardLayout;
	mediaPosition: MediaPosition;
	actionPlacement: ActionPlacement;
	cardRadius: CardRadius;
	showFavicon: boolean;
	placeholderStyle: PlaceholderStyle;
	placeholderFont: string;
	glassmorphism: boolean;
	visibleActions: VisibleActions;
}

/** Payload stored inside a `~~~link-preview` block. */
export interface PreviewData {
	url: string;
	title?: string;
	description?: string;
	image?: string;
	icon?: string;
	siteName?: string;
	alias?: string;
	layout?: CardLayout;
	mediaPosition?: MediaPosition;
	imageLocked?: boolean;
	id?: string;
	fetchedAt?: number;
}

export interface BlockHit {
	start: number;
	end: number;
	data: PreviewData;
}

export type ScanType = "link" | "preview" | "inline";

export interface ScanItem {
	type: ScanType;
	line: number;
	end: number;
	url: string;
	title?: string;
}

export interface EditorContext {
	file: TFile;
	editor: Editor;
}

export type ImageDoneMode = "set" | "remove" | "auto";
