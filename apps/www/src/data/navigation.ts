import { PLAYGROUND_URL } from './playground-url';

export const GITHUB_REPO_URL = 'https://github.com/maelstrom-co/maelstrom';
export const INSTALL_COMMAND = 'npm install @maelstrom-co/react';

export const navLinks = [
  { label: 'How It Works', href: '/#how' },
  { label: 'Demo', href: '/#demo' },
  { label: 'Playground', href: PLAYGROUND_URL },
  { label: 'Docs', href: 'https://docs.maelstrom-ai.co' },
  { label: 'Blog', href: '/blog/' },
] as const;

export const socialLinks = [
  {
    label: 'GitHub',
    href: GITHUB_REPO_URL,
  },
  {
    label: 'X',
    href: 'https://x.com/maelstrom_co',
  },
] as const;
