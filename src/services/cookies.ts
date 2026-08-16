import type { App } from 'obsidian';
import type { CookieProvider, CookieSessionRecord, CookieSessionStatus } from '../types';
import { hostOf } from '../utils/url';

const SECRET_IDS: Record<CookieProvider, string> = {
  facebook: 'link-preview-card-facebook-cookie',
  instagram: 'link-preview-card-instagram-cookie',
  reddit: 'link-preview-card-reddit-cookie',
  tiktok: 'link-preview-card-tiktok-cookie',
};

const HOST_GROUPS: Record<CookieProvider, string[]> = {
  facebook: ['facebook.com', 'fb.com'],
  instagram: ['instagram.com'],
  reddit: ['reddit.com', 'redd.it'],
  tiktok: ['tiktok.com'],
};

const MAX_COOKIE_LENGTH = 32_768;
const SAFE_COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function belongs(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function providerForHost(host: string): CookieProvider | undefined {
  for (const provider of Object.keys(HOST_GROUPS) as CookieProvider[]) {
    if (HOST_GROUPS[provider].some((domain) => belongs(host, domain))) return provider;
  }
  return undefined;
}

function sanitizeCookieHeader(value: string): string | null {
  if (/[\r\n]/.test(value)) return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_COOKIE_LENGTH) return null;

  const pairs: string[] = [];
  for (const raw of normalized.split(';')) {
    const part = raw.trim();
    if (!part) continue;
    const equals = part.indexOf('=');
    if (equals <= 0) return null;
    const name = part.slice(0, equals).trim();
    const cookieValue = part.slice(equals + 1).trim();
    if (!SAFE_COOKIE_NAME.test(name) || !cookieValue || /[\r\n]/.test(cookieValue)) return null;
    if (/^(path|domain|expires|max-age|secure|httponly|samesite|priority|partitioned)$/i.test(name)) return null;
    pairs.push(`${name}=${cookieValue}`);
  }

  return pairs.length ? pairs.join('; ') : null;
}

export class CookieSessionManager {
  private cache = new Map<CookieProvider, CookieSessionRecord>();

  constructor(private readonly app: App) {}

  async initialize(): Promise<void> {
    this.cache.clear();
    for (const provider of Object.keys(SECRET_IDS) as CookieProvider[]) {
      const record = await this.read(provider);
      if (record && (!record.expiresAt || record.expiresAt > Date.now())) this.cache.set(provider, record);
    }
  }

  async getForUrl(url: string): Promise<string | undefined> {
    const provider = providerForHost(hostOf(url));
    if (!provider) return undefined;
    const record = await this.getRecord(provider);
    return record?.cookie;
  }

  async set(provider: CookieProvider, value: string, expiresAt?: number): Promise<boolean> {
    const cookie = sanitizeCookieHeader(value);
    if (!cookie) return false;

    const record: CookieSessionRecord = { cookie, updatedAt: Date.now(), expiresAt };
    this.app.secretStorage.setSecret(SECRET_IDS[provider], JSON.stringify(record));
    this.cache.set(provider, record);
    return true;
  }

  async clear(provider?: CookieProvider): Promise<void> {
    if (provider) {
      this.app.secretStorage.setSecret(SECRET_IDS[provider], '');
      this.cache.delete(provider);
      return;
    }
    for (const item of Object.keys(SECRET_IDS) as CookieProvider[]) await this.clear(item);
  }

  async status(provider: CookieProvider): Promise<CookieSessionStatus> {
    const record = await this.getRecord(provider);
    return record
      ? { configured: true, updatedAt: record.updatedAt, expiresAt: record.expiresAt, masked: this.maskCookie(record.cookie) }
      : { configured: false };
  }

  async getRecord(provider: CookieProvider): Promise<CookieSessionRecord | undefined> {
    const cached = this.cache.get(provider);
    if (cached) {
      if (cached.expiresAt && cached.expiresAt <= Date.now()) {
        await this.clear(provider);
        return undefined;
      }
      return cached;
    }

    const record = await this.read(provider);
    if (!record) return undefined;
    if (record.expiresAt && record.expiresAt <= Date.now()) {
      await this.clear(provider);
      return undefined;
    }
    this.cache.set(provider, record);
    return record;
  }

  async test(provider: CookieProvider): Promise<boolean> {
    const record = await this.getRecord(provider);
    return Boolean(record?.cookie);
  }

  dispose(): void {
    this.cache.clear();
  }

  private async read(provider: CookieProvider): Promise<CookieSessionRecord | undefined> {
    try {
      const raw = this.app.secretStorage.getSecret(SECRET_IDS[provider]);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as unknown;
      if (!isCookieRecord(parsed)) return undefined;
      return parsed;
    } catch {
      return undefined;
    }
  }

  private maskCookie(cookie: string): string {
    return cookie.split(';').map((part) => {
      const equals = part.indexOf('=');
      return equals > 0 ? `${part.slice(0, equals)}=••••` : '••••';
    }).join('; ');
  }
}

function isCookieRecord(value: unknown): value is CookieSessionRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.cookie === 'string'
    && record.cookie.length > 0
    && record.cookie.length <= MAX_COOKIE_LENGTH
    && typeof record.updatedAt === 'number'
    && (!('expiresAt' in record) || typeof record.expiresAt === 'number');
}
