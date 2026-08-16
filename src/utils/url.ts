export function cleanUrl(value: string): string {
  return value.trim().replace(/[.,;:!?]+$/, '');
}

export function parseHttpUrl(value: string): URL | null {
  const cleaned = cleanUrl(value);
  if (!cleaned) return null;
  try {
    const url = new URL(cleaned);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>()"']+/gi) ?? [];
  return [...new Set(matches.map(cleanUrl).filter((value) => parseHttpUrl(value) !== null))];
}

export function hostOf(value: string): string {
  try { return new URL(value).hostname.replace(/^www\./i, '').toLowerCase(); }
  catch { return ''; }
}

export function isYouTube(value: string): boolean {
  const host = hostOf(value);
  return host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be';
}

export function isVimeo(value: string): boolean {
  const host = hostOf(value);
  return host === 'vimeo.com' || host === 'player.vimeo.com';
}

export function isDirectVideo(value: string): boolean {
  try { return /\.(mp4|webm|ogg|mov|m4v)$/i.test(new URL(value).pathname); }
  catch { return false; }
}

export function isGoogleDrive(value: string): boolean {
  return hostOf(value) === 'drive.google.com';
}

export function googleDriveId(value: string): string | null {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/\/file\/d\/([^/]+)/);
    return match?.[1] ?? url.searchParams.get('id');
  } catch { return null; }
}

export function googleDriveDownloadUrl(value: string): string | null {
  const id = googleDriveId(value);
  return id ? `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}` : null;
}

export function absoluteUrl(base: string, value: string | null | undefined): string {
  if (!value) return '';
  try { return new URL(value, base).href; } catch { return ''; }
}

export function videoEmbedUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const host = hostOf(value);
    if (host === 'youtu.be') {
      const id = url.pathname.split('/')[1];
      return id ? `https://www.youtube.com/embed/${encodeURIComponent(id)}` : null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const id = url.searchParams.get('v');
      if (id) return `https://www.youtube.com/embed/${encodeURIComponent(id)}`;
      const embed = url.pathname.match(/^\/embed\/([^/]+)/);
      if (embed?.[1]) return `https://www.youtube.com/embed/${encodeURIComponent(embed[1])}`;
      const shorts = url.pathname.match(/^\/shorts\/([^/]+)/);
      if (shorts?.[1]) return `https://www.youtube.com/embed/${encodeURIComponent(shorts[1])}`;
    }
    if (host === 'vimeo.com') {
      const id = url.pathname.split('/')[1];
      return id ? `https://player.vimeo.com/video/${encodeURIComponent(id)}` : null;
    }
    if (host === 'player.vimeo.com' && url.pathname.startsWith('/video/')) return url.href;
    if (isDirectVideo(value)) return value;
    return null;
  } catch { return null; }
}
