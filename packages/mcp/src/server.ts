// createServer(): an McpServer with get_design_context registered — the
// piece the CLI (`lanhu mcp`) and embedders mount on a transport.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  type LanhuMcpOptions,
  registerGetDesignContext
} from './get-design-context';
import { MCP_PKG_NAME, MCP_PKG_VERSION } from './version';

export function createServer(options: LanhuMcpOptions): McpServer {
  const server = new McpServer({
    name: MCP_PKG_NAME,
    version: MCP_PKG_VERSION
  });
  registerGetDesignContext(server, options);
  return server;
}
