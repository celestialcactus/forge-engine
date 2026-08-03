import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ForgeRuntime, RustKernelRuntime, TypeScriptConformanceRuntime } from '../src/runtime.js';

test('exports the Rust kernel adapter as the Forge product runtime', () => {
  assert.equal(ForgeRuntime, RustKernelRuntime);
  assert.notEqual(ForgeRuntime, TypeScriptConformanceRuntime);
});