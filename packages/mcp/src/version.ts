import pkg from '../package.json';

export const MCP_PKG_NAME = '@lanhu-context/mcp';
export const MCP_PKG_VERSION: string = (pkg as { version: string }).version;
