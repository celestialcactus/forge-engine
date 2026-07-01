import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../../../src/core/tools/tool-registry.js';
import { defineTool } from '../../../src/core/tools/native.js';
import { z } from 'zod';

const mockTool1 = defineTool({
  name: 'read_test',
  description: 'Reads data',
  category: 'read',
  parameters: z.object({}),
  execute: async () => 'data'
});

const mockTool2 = defineTool({
  name: 'write_test',
  description: 'Writes data',
  category: 'write',
  parameters: z.object({}),
  execute: async () => 'done'
});

describe('ToolRegistry', () => {
  it('registers tools correctly', () => {
    const registry = new ToolRegistry();
    registry.register(mockTool1);
    
    // Attempting to register the same tool throws
    expect(() => registry.register(mockTool1)).toThrow(/already registered/);
  });

  it('filters tools by agent role correctly', () => {
    const registry = new ToolRegistry();
    registry.register(mockTool1); // 'read'
    registry.register(mockTool2); // 'write'

    // 'analysis' role only has 'read', 'search'
    const analysisTools = registry.getToolsForRole('analysis');
    expect(analysisTools.length).toBe(1);
    expect(analysisTools[0].name).toBe('read_test');

    // 'implementation' role has 'read', 'write', etc.
    const implTools = registry.getToolsForRole('implementation');
    expect(implTools.length).toBe(2);
  });
});
