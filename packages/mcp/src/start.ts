// startServer(): mount the MCP server on a transport.
//
// - stdio (default): stdout carries JSON-RPC frames only; all logging must go
//   to stderr (the `log` callback defaults to stderr).
// - http: streamable HTTP on POST /mcp, stateless like upstream — a fresh
//   McpServer + transport per request, GET/DELETE answered with 405.

import { Buffer } from 'node:buffer';
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as NodeHttpServer,
  type ServerResponse
} from 'node:http';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { LanhuMcpOptions } from './get-design-context';
import { createServer } from './server';

export type McpTransportKind = 'stdio' | 'http';

export const DEFAULT_HTTP_HOST = '127.0.0.1';
export const DEFAULT_HTTP_PORT = 5200;

export interface StartServerOptions extends LanhuMcpOptions {
  /** Transport to mount (default stdio). */
  transport?: McpTransportKind;
  /** HTTP host (default 127.0.0.1; --http only). */
  host?: string;
  /** HTTP port (default 5200; --http only). */
  port?: number;
  /** Diagnostics sink; must never write to stdout in stdio mode. */
  log?: (message: string) => void;
}

export interface RunningServer {
  transport: McpTransportKind;
  /** HTTP endpoint URL (http transport only). */
  url?: string;
  close(): Promise<void>;
}

export async function startServer(
  options: StartServerOptions
): Promise<RunningServer> {
  const log =
    options.log ?? ((message: string) => process.stderr.write(`${message}\n`));

  if ((options.transport ?? 'stdio') === 'http') {
    return startHttpServer(options, log);
  }

  const server = createServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return {
    transport: 'stdio',
    close: async () => {
      await server.close();
    }
  };
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw === '') return undefined;
  return JSON.parse(raw);
}

async function startHttpServer(
  options: StartServerOptions,
  log: (message: string) => void
): Promise<RunningServer> {
  const host = options.host ?? DEFAULT_HTTP_HOST;
  const port = options.port ?? DEFAULT_HTTP_PORT;

  const httpServer: NodeHttpServer = createHttpServer(
    (req: IncomingMessage, res: ServerResponse) => {
      void handleRequest(req, res, options, log);
    }
  );

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      httpServer.removeListener('error', reject);
      resolve();
    });
  });

  const url = `http://${host}:${port}/mcp`;
  log(`[http] MCP server running on ${url}`);

  return {
    transport: 'http',
    url,
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close(error => (error ? reject(error) : resolve()));
      })
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: StartServerOptions,
  log: (message: string) => void
): Promise<void> {
  const pathname = (req.url ?? '/').split('?')[0];
  if (pathname !== '/mcp') {
    res.writeHead(404).end('Not Found');
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'POST' }).end('Method Not Allowed');
    return;
  }

  try {
    const body = await readJsonBody(req);
    // Stateless per-request server, matching upstream: no session ids.
    const server = createServer(options);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (error) {
    log(`[mcp] unhandled request error: ${String(error)}`);
    if (!res.headersSent) {
      res
        .writeHead(500, { 'content-type': 'application/json' })
        .end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
}
