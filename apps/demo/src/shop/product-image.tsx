// Draws a deterministic inline-SVG packshot. It never fetches anything, so there is no load-failure path.
import type { Product } from './stores/fixtures';

const SIZE_PX = { thumb: 32, hero: 88 } as const;
const LABEL_SWATCHES = ['#D97742', '#7A9E7E', '#D9A441', '#8FA7C4'] as const;
const SPECIES_FILL = {
  dog: 'var(--shop-dog)',
  cat: 'var(--shop-cat)',
} as const;
const NEUTRAL_FILL = '#E6DED2';

export interface ProductImageProps {
  product: Pick<Product, 'species' | 'foodType' | 'brand' | 'name'>;
  size: keyof typeof SIZE_PX;
  className?: string;
}

export function ProductImage({ product, size, className }: ProductImageProps) {
  const px = SIZE_PX[size];
  const known = product.species in SPECIES_FILL;
  const bodyFill = known ? SPECIES_FILL[product.species] : NEUTRAL_FILL;
  const shape = product.foodType === 'dry' ? 'bag' : 'tin';
  const labelFill =
    LABEL_SWATCHES[hashString(product.brand) % LABEL_SWATCHES.length];
  const initial = product.brand.trim().charAt(0).toUpperCase();

  return (
    <div
      aria-hidden="true"
      className={className}
      data-shape={shape}
      data-size={size}
      data-species={known ? product.species : 'unknown'}
      style={{
        width: px,
        height: px,
        borderRadius: 10,
        background: 'var(--shop-thumb-bg)',
        flexShrink: 0,
        display: 'inline-flex',
      }}
    >
      <svg viewBox="0 0 88 88" width={px} height={px}>
        {shape === 'bag' ? (
          <path
            data-part="body"
            d="M24 14 Q44 6 64 14 L68 28 L70 74 Q70 80 64 80 L24 80 Q18 80 18 74 L20 28 Z"
            fill={bodyFill}
          />
        ) : (
          <rect
            data-part="body"
            x="16"
            y="26"
            width="56"
            height="46"
            rx="8"
            fill={bodyFill}
          />
        )}
        {shape === 'tin' && (
          <rect x="16" y="22" width="56" height="8" rx="4" fill="#00000026" />
        )}
        <rect
          data-part="label"
          x="20"
          y="40"
          width="48"
          height="26"
          rx="4"
          fill={labelFill}
        />
        <text
          x="44"
          y="59"
          textAnchor="middle"
          fontSize="18"
          fontWeight="700"
          fill="#FFFFFF"
          fontFamily="inherit"
        >
          {initial}
        </text>
        <g
          data-part="paw"
          fill="#FFFFFF"
          opacity="0.85"
          transform="translate(37 20)"
        >
          <ellipse cx="7" cy="9" rx="4" ry="3.2" />
          <circle cx="2" cy="4.5" r="1.6" />
          <circle cx="5.5" cy="2" r="1.6" />
          <circle cx="9.5" cy="2" r="1.6" />
          <circle cx="13" cy="4.5" r="1.6" />
        </g>
      </svg>
    </div>
  );
}

function hashString(value: string): number {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}
