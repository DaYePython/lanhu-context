declare module 'crx3' {
  interface Crx3Options {
    keyPath?: string;
    crxPath?: string;
    zipPath?: string;
    xmlPath?: string;
    crxURL?: string;
    appVersion?: string;
    browserVersion?: string;
    forceDateTime?: number;
  }

  export default function crx3(
    files: string[],
    options?: Crx3Options
  ): Promise<unknown>;
}
