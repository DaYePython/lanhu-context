// Extract design-token hints for high-risk sketch elements such as gradients,
// non-uniform radii, borders, and shadows.
//
// Two-layer API:
// - extractDesignTokenEntries(): structured entries (used by `lanhu tokens`
//   for --format json/css output);
// - extractDesignTokens(): the legacy text rendering derived from the same
//   entries (used inside context.md) — output format is unchanged.

import type { BorderObj, FillObj, ShadowObj } from '../types/index';
import { roundNum } from './css-helpers';

const NOISE_TYPES = new Set(['color', 'gradient', 'colorStop', 'colorControl']);

// Structured token entry (all numbers already rounded for display).
export interface DesignTokenFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesignTokenFill {
  kind: 'solid' | 'gradient';
  /** Solid: the color value; gradient: a CSS linear-gradient() string. */
  value: string;
}

export interface DesignTokenBorder {
  thickness: number;
  position: string;
  color: string;
}

export interface DesignTokenShadow {
  color: string;
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
}

export interface DesignTokenEntry {
  type: string;
  name: string;
  /** Layer path (parent/child); present only for nested layers. */
  path?: string;
  frame: DesignTokenFrame;
  radius?: number | number[];
  fills: DesignTokenFill[];
  borders: DesignTokenBorder[];
  /** Opacity percentage, present only when < 100. */
  opacity?: number;
  shadows: DesignTokenShadow[];
}

function getDimensions(
  obj: Record<string, unknown>
): [number, number, number, number] {
  const frame = (obj.ddsOriginFrame || obj.layerOriginFrame || {}) as Record<
    string,
    number
  >;
  const x = frame.x ?? (obj.left as number) ?? 0;
  const y = frame.y ?? (obj.top as number) ?? 0;
  const w = frame.width ?? (obj.width as number) ?? 0;
  const h = frame.height ?? (obj.height as number) ?? 0;
  return [x || 0, y || 0, w || 0, h || 0];
}

function simplifyFill(fill: FillObj): DesignTokenFill | null {
  if (fill.isEnabled === false) return null;
  const fillType = fill.fillType ?? 0;
  if (fillType === 0) {
    return { kind: 'solid', value: fill.color?.value ?? 'unknown' };
  }
  if (fillType === 1) {
    const gradient = fill.gradient || {};
    const stops = gradient.colorStops || [];
    const from = gradient.from || {};
    const to = gradient.to || {};
    const dx = (to.x ?? 0.5) - (from.x ?? 0.5);
    const dy = (to.y ?? 0) - (from.y ?? 0);
    const angle = Math.round((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
    const parts = stops.map(s => {
      const c = s.color?.value ?? 'unknown';
      const p = Math.round((s.position ?? 0) * 100);
      return `${c} ${p}%`;
    });
    return {
      kind: 'gradient',
      value: `linear-gradient(${angle}deg, ${parts.join(', ')})`
    };
  }
  return null;
}

function simplifyBorder(border: BorderObj): DesignTokenBorder | null {
  if (border.isEnabled === false) return null;
  const color = border.color?.value ?? 'unknown';
  const thickness = roundNum(border.thickness ?? 1);
  const posMap: Record<string, string> = {
    内边框: 'inside',
    外边框: 'outside',
    中心边框: 'center'
  };
  const pos = posMap[border.position ?? ''] ?? border.position ?? 'center';
  return { thickness, position: pos, color };
}

function simplifyShadow(shadow: ShadowObj): DesignTokenShadow | null {
  if (shadow.isEnabled === false) return null;
  return {
    color: shadow.color?.value ?? 'unknown',
    offsetX: roundNum(shadow.offsetX ?? 0),
    offsetY: roundNum(shadow.offsetY ?? 0),
    blur: roundNum(shadow.blurRadius ?? 0),
    spread: roundNum(shadow.spread ?? 0)
  };
}

function hasOnlyTransparentSolid(fills: FillObj[]): boolean {
  for (const f of fills) {
    if (f.isEnabled === false) continue;
    if ((f.fillType ?? 0) === 0) {
      const val = f.color?.value ?? '';
      if (val.includes('rgba') && val.replace(/\s/g, '').includes(',0)'))
        continue;
      const alpha = f.color?.alpha ?? f.color?.a ?? 1;
      if (alpha === 0) continue;
    }
    return false;
  }
  return true;
}

function isHighRisk(obj: Record<string, unknown>): boolean {
  const objType = String(obj.type ?? obj.ddsType ?? '').toLowerCase();
  if (NOISE_TYPES.has(objType)) return false;

  const [, , w, h] = getDimensions(obj);
  if (w < 8 || h < 8) return false;

  // Skip invisible elements.
  const opacity = obj.opacity as number | undefined;
  if (opacity != null && opacity === 0) return false;

  const fills = (obj.fills ?? []) as FillObj[];
  if (fills.some(f => f.isEnabled !== false && f.fillType === 1)) return true;

  const borders = (obj.borders ?? []) as BorderObj[];
  if (borders.some(b => b.isEnabled !== false)) return true;

  const radius = obj.radius;
  if (Array.isArray(radius) && new Set(radius).size > 1) return true;

  if (opacity != null && opacity < 100) {
    if (hasOnlyTransparentSolid(fills) && !obj.borders && !obj.shadows)
      return false;
    return true;
  }

  const shadows = (obj.shadows ?? []) as ShadowObj[];
  if (shadows.some(s => s.isEnabled !== false)) return true;

  return false;
}

function toEntry(
  obj: Record<string, unknown>,
  parentPath: string
): DesignTokenEntry {
  const objType = obj.type ?? obj.ddsType ?? 'unknown';
  const name = String(obj.name ?? '');
  const [x, y, w, h] = getDimensions(obj);

  let radius: number | number[] | undefined;
  const rawRadius = obj.radius;
  if (rawRadius != null) {
    radius = Array.isArray(rawRadius)
      ? (rawRadius as number[]).map(r => roundNum(r))
      : roundNum(rawRadius as number);
  }

  const fills: DesignTokenFill[] = [];
  for (const f of (obj.fills ?? []) as FillObj[]) {
    const s = simplifyFill(f);
    if (s) fills.push(s);
  }
  const borders: DesignTokenBorder[] = [];
  for (const b of (obj.borders ?? []) as BorderObj[]) {
    const s = simplifyBorder(b);
    if (s) borders.push(s);
  }
  const shadows: DesignTokenShadow[] = [];
  for (const sh of (obj.shadows ?? []) as ShadowObj[]) {
    const s = simplifyShadow(sh);
    if (s) shadows.push(s);
  }

  const opacity = obj.opacity as number | undefined;

  return {
    type: String(objType),
    name,
    path: parentPath ? `${parentPath}/${name}` : undefined,
    frame: {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(w),
      height: Math.round(h)
    },
    radius,
    fills,
    borders,
    opacity: opacity != null && opacity < 100 ? opacity : undefined,
    shadows
  };
}

export function extractDesignTokenEntries(
  sketchData: Record<string, unknown>
): DesignTokenEntry[] {
  const entries: DesignTokenEntry[] = [];
  const visited = new WeakSet<Record<string, unknown>>();

  function buildPath(parentPath: string, name: string): string {
    return parentPath ? `${parentPath}/${name}` : name;
  }

  function walk(obj: Record<string, unknown>, parentPath: string = ''): void {
    if (!obj || typeof obj !== 'object') return;
    if (visited.has(obj)) return;
    visited.add(obj);
    if (obj.isVisible === false) return;

    const name = String(obj.name ?? '');
    const currentPath = buildPath(parentPath, name);

    if (isHighRisk(obj)) {
      entries.push(toEntry(obj, parentPath));
    }

    for (const child of (obj.layers ?? []) as Record<string, unknown>[]) {
      walk(child, currentPath);
    }
  }

  const artboard = sketchData.artboard as Record<string, unknown> | undefined;
  if (artboard?.layers) {
    for (const layer of artboard.layers as Record<string, unknown>[]) {
      walk(layer);
    }
  } else if (sketchData.info) {
    for (const item of sketchData.info as Record<string, unknown>[]) {
      walk(item);
      for (const value of Object.values(item)) {
        if (typeof value === 'object' && value && !Array.isArray(value)) {
          walk(value as Record<string, unknown>);
        } else if (Array.isArray(value)) {
          for (const v of value) {
            if (typeof v === 'object' && v) walk(v as Record<string, unknown>);
          }
        }
      }
    }
  }

  return entries;
}

// Legacy text rendering of one entry — format kept byte-identical to the
// pre-refactor implementation (context.md consumers depend on it).
function renderEntry(entry: DesignTokenEntry): string {
  const { frame } = entry;
  const lines: string[] = [
    `[${entry.type}] "${entry.name}" @(${frame.x},${frame.y}) ${frame.width}x${frame.height}`
  ];
  if (entry.path) lines[0] += `  path: ${entry.path}`;

  if (entry.radius != null) {
    if (Array.isArray(entry.radius)) {
      lines.push(
        new Set(entry.radius).size === 1
          ? `  radius: ${entry.radius[0]}`
          : `  radius: ${JSON.stringify(entry.radius)}`
      );
    } else {
      lines.push(`  radius: ${entry.radius}`);
    }
  }

  for (const fill of entry.fills) {
    lines.push(
      fill.kind === 'solid'
        ? `  fill: solid(${fill.value})`
        : `  fill: ${fill.value}`
    );
  }
  for (const border of entry.borders) {
    lines.push(
      `  border: ${border.thickness}px ${border.position} ${border.color}`
    );
  }
  if (entry.opacity != null) lines.push(`  opacity: ${entry.opacity}%`);
  for (const shadow of entry.shadows) {
    lines.push(
      `  shadow: ${shadow.color} ${shadow.offsetX}px ${shadow.offsetY}px ${shadow.blur}px ${shadow.spread}px`
    );
  }

  return lines.join('\n');
}

export function extractDesignTokens(
  sketchData: Record<string, unknown>
): string {
  const entries = extractDesignTokenEntries(sketchData);
  return entries.length > 0 ? entries.map(renderEntry).join('\n') : '';
}

// --- CSS variables output (`lanhu tokens --format css`) ---

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'token';
}

function cssRadiusValue(radius: number | number[]): string {
  if (Array.isArray(radius)) {
    return new Set(radius).size === 1
      ? `${radius[0]}px`
      : radius.map(r => `${r}px`).join(' ');
  }
  return `${radius}px`;
}

function varName(slug: string, kind: string, index: number): string {
  return index === 0 ? `--${slug}-${kind}` : `--${slug}-${kind}-${index + 1}`;
}

/**
 * Render token entries as CSS custom properties in a `:root { ... }` block.
 * Values are CSS-usable where possible: solid fills become colors, gradients
 * stay linear-gradient() strings, borders become `<w>px solid <color>`
 * shorthand, shadows use box-shadow ordering, opacity becomes a 0-1 number.
 */
export function formatDesignTokensCss(entries: DesignTokenEntry[]): string {
  if (entries.length === 0) return ':root {}\n';

  const used = new Map<string, number>();
  const lines: string[] = [':root {'];

  for (const entry of entries) {
    const base = slugify(entry.name);
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    const slug = seen === 0 ? base : `${base}-${seen + 1}`;

    const { frame } = entry;
    lines.push(
      `  /* [${entry.type}] "${entry.name}" @(${frame.x},${frame.y}) ${frame.width}x${frame.height} */`
    );

    if (entry.radius != null) {
      lines.push(`  --${slug}-radius: ${cssRadiusValue(entry.radius)};`);
    }
    entry.fills.forEach((fill, i) => {
      lines.push(`  ${varName(slug, 'fill', i)}: ${fill.value};`);
    });
    entry.borders.forEach((border, i) => {
      lines.push(
        `  ${varName(slug, 'border', i)}: ${border.thickness}px solid ${border.color};`
      );
    });
    if (entry.opacity != null) {
      lines.push(`  --${slug}-opacity: ${roundNum(entry.opacity / 100)};`);
    }
    entry.shadows.forEach((shadow, i) => {
      lines.push(
        `  ${varName(slug, 'shadow', i)}: ${shadow.offsetX}px ${shadow.offsetY}px ${shadow.blur}px ${shadow.spread}px ${shadow.color};`
      );
    });
  }

  lines.push('}');
  return `${lines.join('\n')}\n`;
}
