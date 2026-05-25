export const GITHUB_REPO_URL = 'https://github.com/maelstrom-co/maelstrom';
export const INSTALL_COMMAND = 'npm install @maelstrom-co/react';

export const navLinks = [
  { label: 'How It Works', href: '#how' },
  { label: 'Demo', href: '#demo' },
  { label: 'Docs', href: 'https://docs.maelstrom-ai.co' },
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
