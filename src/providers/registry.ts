import type { LinkProvider } from './types';
import { facebookProvider, genericProvider, instagramProvider, redditProvider, tiktokProvider, vimeoProvider, xProvider, youtubeProvider } from './builtin';

export class ProviderRegistry {
  private providers: LinkProvider[] = [youtubeProvider, vimeoProvider, tiktokProvider, redditProvider, instagramProvider, facebookProvider, xProvider, genericProvider];

  register(provider: LinkProvider): void {
    this.providers = [provider, ...this.providers.filter((item) => item.id !== provider.id)];
  }

  get(url: URL): LinkProvider {
    return this.providers.find((provider) => provider.match(url)) ?? genericProvider;
  }

  list(): readonly LinkProvider[] { return this.providers; }
}
