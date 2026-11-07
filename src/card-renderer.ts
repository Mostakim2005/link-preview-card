import { setIcon, setTooltip, type MarkdownPostProcessorContext } from "obsidian";
import type LinkPreviewCard from "./main";
import { DEFAULT_SETTINGS } from "./settings";
import { hostOf, logoLabelOf, parseUrl } from "./tracker";
import type { PreviewData } from "./types";

/** Renders one `link-preview` fenced block into the reading view. */
export function renderPreviewCard(
	plugin: LinkPreviewCard,
	source: string,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
): void {
	let data: PreviewData;
	try {
		const parsed: unknown = JSON.parse(source);
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			typeof (parsed as PreviewData).url !== "string" ||
			!parseUrl((parsed as PreviewData).url)
		) {
			throw new Error("bad url");
		}
		data = parsed as PreviewData;
	} catch {
		el.createEl("pre", { text: source });
		return;
	}

	el.addClass("lpc-root");
	const font = (plugin.settings.placeholderFont || "").trim();
	if (font) {
		el.style.setProperty("--lpc-placeholder-font", font);
	}

	const layout = data.layout || plugin.settings.cardLayout || "standard";
	const mediaPos = data.mediaPosition || plugin.settings.mediaPosition || "left";
	const radius = plugin.settings.cardRadius || "rounded";

	const card = el.createDiv({
		cls: `lpc-card is-layout-${layout} is-media-${mediaPos} is-radius-${radius}`,
	});
	const media = card.createDiv({ cls: "lpc-media" });
	const host = hostOf(data.url);
	const displaySite = (data.siteName || host).trim();
	const logoLabel = logoLabelOf(data);

	const showPlaceholder = () => {
		media.empty();
		media.removeClass("is-contain");
		card.removeClass("has-image");
		card.addClass("is-placeholder");

		const styleMode = plugin.settings.placeholderStyle || "logo-name";
		const box = media.createDiv({ cls: `lpc-placeholder is-${styleMode}` });

		if (styleMode === "icon-and-name") {
			const tile = box.createDiv({
				cls: "lpc-avatar",
				text: (logoLabel[0] || host[0] || "?").toUpperCase(),
			});
			if (/^https?:\/\//i.test(data.icon || "")) {
				const icon = tile.createEl("img", {
					cls: "lpc-avatar-img",
					attr: {
						src: data.icon ?? "",
						alt: "",
						loading: "lazy",
						referrerpolicy: "no-referrer",
					},
				});
				icon.addEventListener("load", () => tile.addClass("has-icon"), { once: true });
				icon.addEventListener("error", () => icon.remove(), { once: true });
			}
			box.createDiv({ cls: "lpc-placeholder-name", text: logoLabel });
		} else {
			const logo = box.createDiv({ cls: "lpc-logo-mark" });
			logo.createSpan({ cls: "lpc-logo-text", text: logoLabel });
		}
	};

	const imageSrc = plugin.resolveImage(data.image ?? "", ctx.sourcePath);
	if (imageSrc) {
		card.addClass("has-image");
		const img = media.createEl("img", {
			cls: "lpc-image",
			attr: { src: imageSrc, alt: "", loading: "lazy", referrerpolicy: "no-referrer" },
		});
		img.addEventListener(
			"load",
			() => {
				const ratio = img.naturalWidth / (img.naturalHeight || 1);
				if (ratio < 1.25 || img.naturalWidth < 220) media.addClass("is-contain");
			},
			{ once: true },
		);
		img.addEventListener("error", showPlaceholder, { once: true });
	} else {
		showPlaceholder();
	}

	const body = card.createDiv({ cls: "lpc-body" });

	const siteRow = body.createDiv({ cls: "lpc-site-row" });
	if (
		plugin.settings.showFavicon &&
		data.icon &&
		!media.querySelector(".lpc-avatar-img")
	) {
		siteRow.createEl("img", {
			cls: "lpc-site-favicon",
			attr: { src: data.icon ?? "", alt: "", loading: "lazy", referrerpolicy: "no-referrer" },
		});
	}
	siteRow.createDiv({ cls: "lpc-site", text: displaySite });

	const title = body.createEl("a", {
		cls: "lpc-title",
		text: data.alias || data.title || host,
	});
	title.href = data.url;
	title.target = "_blank";
	title.rel = "noopener noreferrer";

	if (plugin.settings.showDescription && data.description) {
		body.createDiv({ cls: "lpc-desc", text: data.description });
	}

	const placement = plugin.settings.actionPlacement || "right";
	const actions = body.createDiv({
		cls: `lpc-actions is-actions-${placement}`,
		attr: { role: "toolbar", "aria-label": "Link actions" },
	});

	const iconButton = (icon: string, label: string, handler: () => void): void => {
		const btn = actions.createEl("button", {
			cls: "clickable-icon lpc-icon-btn",
			attr: { type: "button" },
		});
		setIcon(btn, icon);
		setTooltip(btn, label);
		btn.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			handler();
		});
	};

	const vis = plugin.settings.visibleActions || DEFAULT_SETTINGS.visibleActions;
	if (vis.copy !== false) {
		iconButton("copy", "Copy URL", () => void plugin.copyUrl(data));
	}
	if (vis.alias !== false) {
		iconButton("pencil", "Edit alias", () => plugin.openAliasModal(data, ctx.sourcePath));
	}
	if (vis.image !== false) {
		iconButton("image-plus", "Set preview image", () =>
			plugin.openImageModal(data, ctx.sourcePath),
		);
	}
	if (vis.refresh !== false) {
		iconButton("refresh-cw", "Refresh preview", () =>
			void plugin.refresh(ctx.sourcePath, data),
		);
	}
	if (vis.open !== false) {
		iconButton("external-link", "Open link", () => {
			const safe = parseUrl(data.url);
			if (safe) window.open(safe.href, "_blank", "noopener,noreferrer");
		});
	}
	if (vis.revert !== false) {
		iconButton("undo", "Turn back into link", () =>
			void plugin.revert(ctx.sourcePath, data),
		);
	}

	card.addEventListener("click", (event) => {
		const target = event.target;
		if (!(target instanceof HTMLElement)) return;
		if (target.closest("button") || target.closest("a")) return;
		const safe = parseUrl(data.url);
		if (safe) window.open(safe.href, "_blank", "noopener,noreferrer");
	});

	card.addEventListener("contextmenu", (event) => {
		event.preventDefault();
		event.stopPropagation();
		plugin.showMenu(event, data, ctx.sourcePath);
	});
}
