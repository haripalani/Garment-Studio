// Text fonts, self-hosted from Fontsource (all SIL OFL). `css` is the family name used for drawing
// and stored in the document; `load` pulls the font files in on first use.
export interface FontDef {
  css: string;
  label: string;
  load: () => Promise<unknown>;
}

export const FONTS: readonly FontDef[] = [
  { css: 'Inter Variable', label: 'Inter', load: async () => undefined },
  {
    css: 'Montserrat',
    label: 'Montserrat',
    load: () =>
      Promise.all([
        import('@fontsource/montserrat/400.css'),
        import('@fontsource/montserrat/700.css'),
        import('@fontsource/montserrat/900.css'),
      ]),
  },
  {
    css: 'Rubik',
    label: 'Rubik',
    load: () => Promise.all([import('@fontsource/rubik/400.css'), import('@fontsource/rubik/700.css')]),
  },
  {
    css: 'Roboto Condensed',
    label: 'Roboto Condensed',
    load: () =>
      Promise.all([
        import('@fontsource/roboto-condensed/400.css'),
        import('@fontsource/roboto-condensed/700.css'),
      ]),
  },
  {
    css: 'Oswald',
    label: 'Oswald',
    load: () => Promise.all([import('@fontsource/oswald/400.css'), import('@fontsource/oswald/700.css')]),
  },
  { css: 'Bebas Neue', label: 'Bebas Neue', load: () => import('@fontsource/bebas-neue/400.css') },
  { css: 'Anton', label: 'Anton', load: () => import('@fontsource/anton/400.css') },
  { css: 'Archivo Black', label: 'Archivo Black', load: () => import('@fontsource/archivo-black/400.css') },
  {
    css: 'Unbounded',
    label: 'Unbounded',
    load: () =>
      Promise.all([import('@fontsource/unbounded/400.css'), import('@fontsource/unbounded/700.css')]),
  },
  {
    css: 'Space Mono',
    label: 'Space Mono',
    load: () =>
      Promise.all([import('@fontsource/space-mono/400.css'), import('@fontsource/space-mono/700.css')]),
  },
  {
    css: 'Press Start 2P',
    label: 'Press Start 2P',
    load: () => import('@fontsource/press-start-2p/400.css'),
  },
  {
    css: 'Playfair Display',
    label: 'Playfair Display',
    load: () =>
      Promise.all([
        import('@fontsource/playfair-display/400.css'),
        import('@fontsource/playfair-display/700.css'),
      ]),
  },
  {
    css: 'Cormorant Garamond',
    label: 'Cormorant Garamond',
    load: () =>
      Promise.all([
        import('@fontsource/cormorant-garamond/400.css'),
        import('@fontsource/cormorant-garamond/700.css'),
      ]),
  },
  {
    css: 'Permanent Marker',
    label: 'Permanent Marker',
    load: () => import('@fontsource/permanent-marker/400.css'),
  },
  {
    css: 'Caveat',
    label: 'Caveat',
    load: () => Promise.all([import('@fontsource/caveat/400.css'), import('@fontsource/caveat/700.css')]),
  },
  { css: 'Lobster', label: 'Lobster', load: () => import('@fontsource/lobster/400.css') },
  { css: 'Pacifico', label: 'Pacifico', load: () => import('@fontsource/pacifico/400.css') },
  {
    css: 'UnifrakturMaguntia',
    label: 'UnifrakturMaguntia',
    load: () => import('@fontsource/unifrakturmaguntia/400.css'),
  },
];

export const DEFAULT_FONT = 'Inter Variable';

const ready = new Map<string, Promise<void>>();

/** Loads a family (and the requested weight/style) so canvas text measures and draws correctly. */
export function ensureFont(css: string, weight = 400, italic = false): Promise<void> {
  const key = `${css}|${weight}|${italic}`;
  let p = ready.get(key);
  if (!p) {
    const def = FONTS.find((f) => f.css === css);
    p = (async () => {
      await def?.load();
      if (typeof document !== 'undefined' && document.fonts) {
        await document.fonts
          .load(`${italic ? 'italic ' : ''}${weight} 100px "${css}"`)
          .catch(() => undefined);
      }
    })();
    ready.set(key, p);
  }
  return p;
}
