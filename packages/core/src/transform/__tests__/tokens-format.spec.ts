// Unit tests for structured token entries and the CSS variables formatter
// (M3 `lanhu tokens --format json|css`).
import {
  extractDesignTokenEntries,
  extractDesignTokens,
  formatDesignTokensCss
} from '../design-tokens';

function makeSketch(layers: Record<string, unknown>[]) {
  return { artboard: { layers } };
}

const gradientLayer = {
  name: 'Grad Box',
  type: 'rect',
  ddsOriginFrame: { x: 0, y: 0, width: 100, height: 50 },
  radius: [4, 8, 4, 0],
  opacity: 50,
  fills: [
    {
      isEnabled: true,
      fillType: 1,
      gradient: {
        from: { x: 0, y: 0 },
        to: { x: 0, y: 1 },
        colorStops: [
          { color: { value: '#fff' }, position: 0 },
          { color: { value: '#000' }, position: 1 }
        ]
      }
    }
  ],
  borders: [{ isEnabled: true, color: { value: '#f00' }, thickness: 2 }],
  shadows: [
    {
      isEnabled: true,
      color: { value: 'rgba(0,0,0,0.3)' },
      offsetX: 2,
      offsetY: 4,
      blurRadius: 8,
      spread: 0
    }
  ]
};

describe('extractDesignTokenEntries', () => {
  test('returns structured entries matching the legacy text rendering', () => {
    const sketch = makeSketch([gradientLayer]);
    const entries = extractDesignTokenEntries(sketch);
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.type).toBe('rect');
    expect(entry.name).toBe('Grad Box');
    expect(entry.frame).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    expect(entry.radius).toEqual([4, 8, 4, 0]);
    expect(entry.fills[0].kind).toBe('gradient');
    expect(entry.fills[0].value).toContain('linear-gradient');
    expect(entry.borders[0]).toEqual({
      thickness: 2,
      position: 'center',
      color: '#f00'
    });
    expect(entry.opacity).toBe(50);
    expect(entry.shadows[0]).toEqual({
      color: 'rgba(0,0,0,0.3)',
      offsetX: 2,
      offsetY: 4,
      blur: 8,
      spread: 0
    });

    // The legacy text output is derived from the same entries.
    const text = extractDesignTokens(sketch);
    expect(text).toContain('[rect] "Grad Box" @(0,0) 100x50');
    expect(text).toContain('radius: [4,8,4,0]');
    expect(text).toContain('border: 2px center #f00');
    expect(text).toContain('opacity: 50%');
    expect(text).toContain('shadow: rgba(0,0,0,0.3) 2px 4px 8px 0px');
  });

  test('empty sketch yields no entries', () => {
    expect(extractDesignTokenEntries(makeSketch([]))).toEqual([]);
  });
});

describe('formatDesignTokensCss', () => {
  test('renders a :root block with CSS-usable values', () => {
    const css = formatDesignTokensCss(
      extractDesignTokenEntries(makeSketch([gradientLayer]))
    );
    expect(css.startsWith(':root {')).toBe(true);
    expect(css.trimEnd().endsWith('}')).toBe(true);
    expect(css).toContain('/* [rect] "Grad Box" @(0,0) 100x50 */');
    expect(css).toContain('--grad-box-radius: 4px 8px 4px 0px;');
    expect(css).toContain('--grad-box-fill: linear-gradient(');
    expect(css).toContain('--grad-box-border: 2px solid #f00;');
    expect(css).toContain('--grad-box-opacity: 0.5;');
    // box-shadow ordering: x y blur spread color.
    expect(css).toContain(
      '--grad-box-shadow: 2px 4px 8px 0px rgba(0,0,0,0.3);'
    );
  });

  test('solid fills become plain color values; uniform radius collapses', () => {
    const css = formatDesignTokensCss([
      {
        type: 'rect',
        name: 'Card',
        frame: { x: 0, y: 0, width: 40, height: 40 },
        radius: [8, 8, 8, 8],
        fills: [{ kind: 'solid', value: '#123456' }],
        borders: [],
        shadows: []
      }
    ]);
    expect(css).toContain('--card-radius: 8px;');
    expect(css).toContain('--card-fill: #123456;');
  });

  test('duplicate names and multiple fills get numeric suffixes', () => {
    const entry = {
      type: 'rect',
      name: 'Box',
      frame: { x: 0, y: 0, width: 40, height: 40 },
      fills: [
        { kind: 'solid' as const, value: '#111' },
        { kind: 'solid' as const, value: '#222' }
      ],
      borders: [],
      shadows: []
    };
    const css = formatDesignTokensCss([entry, { ...entry }]);
    expect(css).toContain('--box-fill: #111;');
    expect(css).toContain('--box-fill-2: #222;');
    expect(css).toContain('--box-2-fill: #111;');
  });

  test('empty entry list renders an empty :root and CJK names survive', () => {
    expect(formatDesignTokensCss([])).toBe(':root {}\n');
    const css = formatDesignTokensCss([
      {
        type: 'rect',
        name: '主按钮',
        frame: { x: 0, y: 0, width: 40, height: 40 },
        radius: 6,
        fills: [],
        borders: [],
        shadows: []
      }
    ]);
    expect(css).toContain('--主按钮-radius: 6px;');
  });
});
