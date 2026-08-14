// Flag parsing tests: citty arg defs (aliases, --no- negation, positional -)
// plus the transform/config flag mappers.
import { LanhuError } from '@lanhu-context/core';
import { parseArgs } from 'citty';
import {
  globalArgs,
  toConcurrency,
  toConfigFlags,
  toTokensFormat,
  toTransformOptions,
  transformArgs
} from '../args';

const urlPositional = {
  url: { type: 'positional', required: false }
} as const;

describe('global flags', () => {
  test('--env-path is an alias of --env-file', () => {
    const args = parseArgs(['--env-path', 'ci.env'], globalArgs);
    expect(args['env-file']).toBe('ci.env');
  });

  test('--prompt-lang is an alias of --lang', () => {
    const args = parseArgs(['--prompt-lang', 'zh-CN'], globalArgs);
    expect(args.lang).toBe('zh-CN');
  });

  test('--no-color negates the default-true color flag', () => {
    expect(parseArgs([], globalArgs).color).toBe(true);
    expect(parseArgs(['--no-color'], globalArgs).color).toBe(false);
  });

  test('-q is an alias of --quiet', () => {
    expect(parseArgs(['-q'], globalArgs).quiet).toBe(true);
  });

  test('a lone - is parsed as the url positional', () => {
    const args = parseArgs(['-', '--json'], {
      ...urlPositional,
      ...globalArgs
    });
    expect(args.url).toBe('-');
    expect(args.json).toBe(true);
  });
});

describe('transform flags', () => {
  test('--tailwindcss keeps working as a deprecated alias of --tailwind', () => {
    expect(parseArgs(['--tailwindcss'], transformArgs).tailwind).toBe(true);
    expect(parseArgs(['--tailwind'], transformArgs).tailwind).toBe(true);
    expect(parseArgs([], transformArgs).tailwind).toBe(false);
  });

  test('toTransformOptions parses valid values', () => {
    const args = parseArgs(
      [
        '--tailwind',
        '--tw-version',
        '4',
        '--unit-scale',
        '0.5',
        '--skip-slices',
        '--assets-dir',
        './assets/lanhu'
      ],
      transformArgs
    );
    expect(toTransformOptions(args)).toEqual({
      tailwind: true,
      twVersion: 4,
      unitScale: 0.5,
      skipSlices: true,
      assetsDir: './assets/lanhu'
    });
  });

  test('toTransformOptions defaults: tw v3, no scale, slices on', () => {
    expect(toTransformOptions(parseArgs([], transformArgs))).toEqual({
      tailwind: false,
      twVersion: 3,
      unitScale: undefined,
      skipSlices: false,
      assetsDir: undefined
    });
  });

  test.each([
    [['--tw-version', '5']],
    [['--tw-version', 'latest']],
    [['--unit-scale', '0']],
    [['--unit-scale', '-1']],
    [['--unit-scale', 'abc']]
  ])('invalid transform flags are usage errors: %j', rawArgs => {
    const args = parseArgs([...rawArgs], transformArgs);
    try {
      toTransformOptions(args);
      throw new Error('expected USAGE_ERROR');
    } catch (error) {
      expect(error).toBeInstanceOf(LanhuError);
      expect((error as LanhuError).code).toBe('USAGE_ERROR');
      expect((error as LanhuError).exitClass).toBe(2);
    }
  });
});

describe('M3 flags: format / concurrency', () => {
  test('toTokensFormat accepts json (default) and css, rejects the rest', () => {
    expect(toTokensFormat({ _: [] })).toBe('json');
    expect(toTokensFormat({ _: [], format: 'json' })).toBe('json');
    expect(toTokensFormat({ _: [], format: 'css' })).toBe('css');
    try {
      toTokensFormat({ _: [], format: 'scss' });
      throw new Error('expected USAGE_ERROR');
    } catch (error) {
      expect(error).toBeInstanceOf(LanhuError);
      expect((error as LanhuError).code).toBe('USAGE_ERROR');
    }
  });

  test('toConcurrency validates a positive integer with a fallback', () => {
    expect(toConcurrency({ _: [] }, 4)).toBe(4);
    expect(toConcurrency({ _: [], concurrency: '8' }, 4)).toBe(8);
    for (const bad of ['0', '-2', '1.5', 'many']) {
      try {
        toConcurrency({ _: [], concurrency: bad }, 4);
        throw new Error(`expected USAGE_ERROR for ${bad}`);
      } catch (error) {
        expect(error).toBeInstanceOf(LanhuError);
        expect((error as LanhuError).code).toBe('USAGE_ERROR');
        expect((error as LanhuError).exitClass).toBe(2);
      }
    }
  });
});

describe('toConfigFlags', () => {
  test('maps parsed args onto the config layer inputs', () => {
    const args = parseArgs(
      [
        '--token',
        't',
        '--dds-token',
        'd',
        '--timeout',
        '5000',
        '--retries',
        '1',
        '--env-file',
        'ci.env',
        '--cwd',
        '/tmp',
        '--lang',
        'zh-CN'
      ],
      globalArgs
    );
    expect(toConfigFlags(args)).toEqual({
      token: 't',
      ddsToken: 'd',
      timeout: '5000',
      retries: '1',
      envFile: 'ci.env',
      cwd: '/tmp',
      lang: 'zh-CN'
    });
  });

  test('absent flags map to undefined', () => {
    expect(toConfigFlags(parseArgs([], globalArgs))).toEqual({
      token: undefined,
      ddsToken: undefined,
      timeout: undefined,
      retries: undefined,
      envFile: undefined,
      cwd: undefined,
      lang: undefined
    });
  });
});
