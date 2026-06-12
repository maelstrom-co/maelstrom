export const oceanTheme = {
  name: 'ocean-deep',
  type: 'dark' as const,
  colors: {
    'editor.background': '#050810',
    'editor.foreground': '#e0f0ff',
  },
  tokenColors: [
    {
      scope: ['keyword', 'storage.type', 'storage.modifier'],
      settings: { foreground: '#00f0ff' },
    },
    { scope: ['string', 'string.quoted'], settings: { foreground: '#00ffa3' } },
    {
      scope: ['entity.name.type', 'support.type'],
      settings: { foreground: '#6b00ff' },
    },
    {
      scope: ['entity.name.function', 'support.function'],
      settings: { foreground: '#0066ff' },
    },
    {
      scope: ['constant.numeric', 'constant.language'],
      settings: { foreground: '#00f0ff' },
    },
    {
      scope: ['variable', 'variable.parameter'],
      settings: { foreground: '#e0f0ff' },
    },
    {
      scope: ['punctuation', 'meta.brace'],
      settings: { foreground: '#7a9ab5' },
    },
    {
      scope: ['comment'],
      settings: { foreground: '#3a5a75', fontStyle: 'italic' },
    },
    {
      scope: ['meta.object-literal.key', 'entity.name.tag'],
      settings: { foreground: '#00f0ff' },
    },
    { scope: ['variable.other.property'], settings: { foreground: '#e0f0ff' } },
  ],
};
