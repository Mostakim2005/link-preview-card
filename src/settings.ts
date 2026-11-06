import type { LinkPreviewSettings } from "./types";
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
