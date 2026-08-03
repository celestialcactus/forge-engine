import type { ForgeWorkspaceServiceOptions } from '../../src/v1/service.js';
import { typeScriptConformanceFixture } from '../../src/v1/service.js';

type ConformanceServiceOverrides = Omit<ForgeWorkspaceServiceOptions, 'runtime'>;

export const conformanceServiceOptions = (
  overrides: ConformanceServiceOverrides = {},
): ForgeWorkspaceServiceOptions => ({
  ...overrides,
  runtime: typeScriptConformanceFixture,
});
