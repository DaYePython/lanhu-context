import pkg from '../package.json';

export const CLI_PKG_NAME = 'lanhu-context-cli';
export const CLI_VERSION: string = (pkg as { version: string }).version;
