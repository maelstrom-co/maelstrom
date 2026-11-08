// @vitest-environment happy-dom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ProductImage } from './product-image';

type Props = Parameters<typeof ProductImage>[0];
type Product = Props['product'];

const base: Product = {
  species: 'dog',
  foodType: 'dry',
  brand: 'Northpaw',
  name: 'Salmon Mix',
};

function renderTile(
  product: Partial<Product> = {},
  size: Props['size'] = 'thumb',
) {
  const { container } = render(
    <ProductImage product={{ ...base, ...product }} size={size} />,
  );
  const tile = container.firstElementChild as HTMLElement;
  const part = (name: string) =>
    tile.querySelector(`[data-part="${name}"]`) as SVGElement;
  return { tile, body: part('body'), label: part('label') };
}

afterEach(cleanup);

describe('ProductImage', () => {
  it('draws a bag for dry food and a tin for wet food', () => {
    expect(renderTile({ foodType: 'dry' }).tile.dataset.shape).toBe('bag');
    cleanup();
    expect(renderTile({ foodType: 'wet' }).tile.dataset.shape).toBe('tin');
  });

  it('fills the body by species', () => {
    const dog = renderTile({ species: 'dog' });
    expect(dog.tile.dataset.species).toBe('dog');
    expect(dog.body.getAttribute('fill')).toBe('var(--shop-dog)');
    cleanup();
    const cat = renderTile({ species: 'cat' });
    expect(cat.body.getAttribute('fill')).toBe('var(--shop-cat)');
  });

  it('picks the same label colour for the same brand', () => {
    const first = renderTile({
      brand: 'Harvest Hound',
      name: 'A',
    }).label.getAttribute('fill');
    cleanup();
    const second = renderTile({
      brand: 'Harvest Hound',
      name: 'B',
    }).label.getAttribute('fill');
    expect(second).toBe(first);
    expect(['#D97742', '#7A9E7E', '#D9A441', '#8FA7C4']).toContain(first);
  });

  it('uses more than one swatch across brands', () => {
    const colours = new Set(
      [
        'Northpaw',
        'Summit Trail',
        'Harvest Hound',
        'Whisker & Co',
        'Tidewater',
        'Alpha',
      ].map((brand) => {
        const fill = renderTile({ brand }).label.getAttribute('fill');
        cleanup();
        return fill;
      }),
    );
    expect(colours.size).toBeGreaterThan(1);
  });

  it('shows the brand initial', () => {
    expect(renderTile({ brand: 'northpaw' }).tile.textContent).toContain('N');
  });

  it('falls back to a neutral fill for unknown species', () => {
    const { tile, body } = renderTile({
      species: 'ferret' as Product['species'],
    });
    expect(tile.dataset.species).toBe('unknown');
    expect(body.getAttribute('fill')).toBe('#E6DED2');
  });

  it('falls back to a tin for unknown food type', () => {
    const { tile } = renderTile({
      foodType: 'freeze-dried' as Product['foodType'],
    });
    expect(tile.dataset.shape).toBe('tin');
  });

  it('sizes the tile as 32px thumb or 88px hero', () => {
    const thumb = renderTile({}, 'thumb');
    expect(thumb.tile.dataset.size).toBe('thumb');
    expect(thumb.tile.style.width).toBe('32px');
    expect(thumb.tile.style.height).toBe('32px');
    cleanup();
    const hero = renderTile({}, 'hero');
    expect(hero.tile.dataset.size).toBe('hero');
    expect(hero.tile.style.width).toBe('88px');
    expect(hero.tile.style.height).toBe('88px');
  });

  it('is hidden from assistive tech and passes className through', () => {
    const { container } = render(
      <ProductImage product={base} size="thumb" className="extra" />,
    );
    const tile = container.firstElementChild as HTMLElement;
    expect(tile.getAttribute('aria-hidden')).toBe('true');
    expect(tile.classList.contains('extra')).toBe(true);
  });
});
