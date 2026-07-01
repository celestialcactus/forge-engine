import { describe, it, expect } from 'vitest';
import { ModelRouter } from '../../../src/core/agents/model-router.js';

describe('ModelRouter', () => {
  const config = {
    localModel: 'ollama:llama3',
    cloudModel: 'anthropic:claude-3-sonnet',
    complexityThreshold: 0.5
  };

  it('routes to local model in sovereign mode', async () => {
    const router = new ModelRouter('sovereign', config);
    const decision = await router.classify('complex refactor task with many files', { files: new Array(10) });
    expect(decision.targetModel).toBe('ollama:llama3');
  });

  it('routes to cloud model in copilot mode', async () => {
    const router = new ModelRouter('copilot', config);
    const decision = await router.classify('simple task', {});
    expect(decision.targetModel).toBe('anthropic:claude-3-sonnet');
  });

  it('routes to cloud model for complex tasks in hybrid mode', async () => {
    const router = new ModelRouter('hybrid', config);
    // Large token budget + multiple files + 'refactor' keyword
    const decision = await router.classify('refactor the entire architecture'.padEnd(10000, 'a'), { files: [1,2,3,4,5] });
    expect(decision.targetModel).toBe('anthropic:claude-3-sonnet');
    expect(decision.confidenceScore).toBeGreaterThanOrEqual(0.5);
  });

  it('routes to local model for simple tasks in hybrid mode', async () => {
    const router = new ModelRouter('hybrid', config);
    const decision = await router.classify('fix typo in readme', { files: [1] });
    expect(decision.targetModel).toBe('ollama:llama3');
    expect(decision.confidenceScore).toBeLessThan(0.5);
  });
});
