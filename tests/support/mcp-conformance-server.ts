import { resolve } from 'node:path';
import { startForgeMcpServer } from '../../src/mcp/server.js';
import { conformanceServiceOptions } from './conformance-runtime.js';

const workspaceRoot = process.argv[2];
if (workspaceRoot === undefined || workspaceRoot.trim().length === 0) {
  throw new Error('MCP conformance server requires a workspace path.');
}

await startForgeMcpServer(resolve(workspaceRoot), conformanceServiceOptions());
