// Link Preview Card
export interface LinkPreviewSettings {
  autoPreview: boolean;
  showDescription: boolean;
  stripTrackers: boolean;
  cardLayout: "standard" | "banner" | "compact";
  mediaPosition: "left" | "right";
  actionPlacement: "right" | "space-between" | "space-evenly" | "left";
  cardRadius: "rounded" | "sharp" | "pill";
  showFavicon: boolean;
  placeholderStyle: "logo-name" | "icon-and-name";
  placeholderFont: string;
  glassmorphism: boolean;
  visibleActions: {
    copy: boolean;
    alias: boolean;
    image: boolean;
    refresh: boolean;
    open: boolean;
    revert: boolean;
  };
}

export interface PreviewData {
  id?: string;
  url: string;
  title: string;
  description?: string;
  imageUrl?: string;
  favicon?: string;
  siteName?: string;
}


