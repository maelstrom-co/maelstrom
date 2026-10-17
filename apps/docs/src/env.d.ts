/// <reference types="astro/client" />

interface Window {
  posthog?: {
    capture: (event: string, properties?: Record<string, unknown>) => void;
  };
}

declare module 'virtual:starlight/user-config' {
  const config: import('@astrojs/starlight/types').StarlightConfig;
  export default config;
}

declare module 'virtual:starlight/components/Search' {
  const Search: typeof import('@astrojs/starlight/components').Search;
  export default Search;
}

declare module 'virtual:starlight/components/SocialIcons' {
  const SocialIcons: typeof import('@astrojs/starlight/components').SocialIcons;
  export default SocialIcons;
}

declare module 'virtual:starlight/components/ThemeSelect' {
  const ThemeSelect: typeof import('@astrojs/starlight/components').ThemeSelect;
  export default ThemeSelect;
}

declare module 'virtual:starlight/components/MobileMenuFooter' {
  const MobileMenuFooter: typeof import('@astrojs/starlight/components').MobileMenuFooter;
  export default MobileMenuFooter;
}
