import { Notice, Menu } from 'obsidian';
import { googleDriveDownloadUrl, isDirectVideo, isGoogleDrive, isVimeo, isYouTube } from './utils/url';
import type { PluginSettings, PreviewData } from './types';

export interface RendererActions {
  refresh(data: PreviewData): Promise<void>;
  edit(data: PreviewData, source: string): Promise<void>;
  changeTitle(data: PreviewData, source: string): Promise<void>;
  revert(data: PreviewData): Promise<void>;
}

export function renderPreview(container: HTMLElement, data: PreviewData, source: string, settings: PluginSettings, actions: RendererActions): void {
  container.addClass('link-preview-card');
  container.dataset.previewId = data.id ?? '';
  container.dataset.source = source;

  const header = container.createDiv({ cls: 'link-preview-header' });
  const titleLink = header.createEl('a', { cls: 'link-preview-title', href: data.url, text: data.title || data.url });
  titleLink.target = '_blank';
  titleLink.rel = 'noopener noreferrer';
  titleLink.ariaLabel = `Open ${data.title || data.url}`;

  if (data.siteName) header.createSpan({ cls: 'link-preview-site', text: data.siteName });
  if (data.author) {
    const author = header.createSpan({ cls: 'link-preview-author', text: data.author });
    if (data.authorUrl) author.setAttribute('data-author-url', data.authorUrl);
  }
  if (settings.fetchDescription && data.description) container.createEl('p', { cls: 'link-preview-description', text: data.description });
  if (settings.fetchContent && data.contentText) container.createEl('p', { cls: 'link-preview-content', text: data.contentText });

  if (settings.showImage && data.image) {
    if (settings.fetchMultipleImages && data.images && data.images.length > 1) {
      const gallery = container.createDiv({ cls: 'link-preview-gallery' });
      for (const [index, src] of data.images.entries()) appendImage(gallery, src, settings, `Preview image ${index + 1}`);
    } else appendImage(container, data.image, settings, 'Preview image');
  }

  if (data.video && data.videoUrl) {
    if (isDirectVideo(data.videoUrl) && settings.showVideoPlayer) {
      const video = container.createEl('video', { cls: 'link-preview-video' });
      video.src = data.videoUrl; video.controls = true; video.playsInline = true;
      applyLazy(video, settings.lazyLoadMedia);
    } else if ((isYouTube(data.url) && settings.embedYouTube) || (isVimeo(data.url) && settings.embedVimeo)) {
      const frame = container.createEl('iframe', { cls: 'link-preview-video-frame' });
      frame.src = data.videoUrl;
      frame.loading = settings.lazyLoadMedia ? 'lazy' : 'eager';
      frame.allowFullscreen = true;
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-popups');
      frame.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
    }
  }

  if (isGoogleDrive(data.url)) {
    const download = googleDriveDownloadUrl(data.url);
    if (download) {
      const link = container.createEl('a', { cls: 'link-preview-download-btn', href: download, text: 'Download' });
      link.target = '_blank'; link.rel = 'noopener noreferrer';
    }
  }

  attachMenu(container, data, source, actions);
  if (settings.autoRefreshOnOpen && data.fetchedAt && Date.now() - data.fetchedAt > settings.cacheMinutes * 60_000) {
    void actions.refresh(data);
  }
}

function appendImage(parent: HTMLElement, src: string, settings: PluginSettings, alt: string): void {
  const img = parent.createEl('img', { cls: 'link-preview-image' });
  img.src = src; img.alt = alt; img.referrerPolicy = 'no-referrer'; img.loading = settings.lazyLoadMedia ? 'lazy' : 'eager';
  img.addEventListener('error', () => img.remove(), { once: true });
}

function applyLazy(element: HTMLMediaElement, enabled: boolean): void {
  if (enabled) element.preload = 'metadata';
}

function attachMenu(container: HTMLElement, data: PreviewData, source: string, actions: RendererActions): void {
  const show = (event: MouseEvent | Touch): void => {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle('Copy link').setIcon('copy').onClick(() => { void navigator.clipboard.writeText(data.url).then(() => new Notice('Link copied')).catch(() => new Notice('Copy failed')); }));
    menu.addItem((item) => item.setTitle('Open link').setIcon('external-link').onClick(() => window.open(data.url, '_blank', 'noopener,noreferrer')));
    menu.addItem((item) => item.setTitle('Refresh preview').setIcon('refresh-cw').onClick(() => { void actions.refresh(data); }));
    menu.addItem((item) => item.setTitle('Edit link').setIcon('pencil').onClick(() => { void actions.edit(data, source); }));
    menu.addItem((item) => item.setTitle('Change title').setIcon('text').onClick(() => { void actions.changeTitle(data, source); }));
    menu.addItem((item) => item.setTitle('Revert to link').setIcon('undo').onClick(() => { void actions.revert(data); }));
    menu.showAtPosition({ x: event.clientX ?? 0, y: event.clientY ?? 0 });
  };
  container.addEventListener('contextmenu', (event) => { event.preventDefault(); show(event); });
  let timer: ReturnType<typeof setTimeout> | undefined;
  container.addEventListener('touchstart', (event) => { const touch = event.touches[0]; if (!touch) return; timer = setTimeout(() => show(touch), 500); }, { passive: true });
  const cancel = (): void => { if (timer) clearTimeout(timer); timer = undefined; };
  container.addEventListener('touchend', cancel, { passive: true });
  container.addEventListener('touchmove', cancel, { passive: true });
}
