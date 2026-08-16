import type { PluginSettings, PreviewData, ProviderId } from '../types';
import type { CookieSessionManager } from '../services/cookies';

export interface ProviderContext {
  settings: PluginSettings;
  cookies: CookieSessionManager;
}

export interface LinkProvider {
  id: ProviderId;
  domains: string[];
  match(url: URL): boolean;
  fetch(url: URL, context: ProviderContext): Promise<PreviewData | null>;
}
