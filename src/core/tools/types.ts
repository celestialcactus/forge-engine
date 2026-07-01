import { z } from 'zod';
import { ToolCategory } from '../types.js';
import { Span } from '@opentelemetry/api';

/**
 * Envelope for a tool's output.
 */
export interface ToolResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Metadata passed to the tool during execution.
 */
export interface ToolExecutionContext {
  span: Span;
  cwd: string;
}

/**
 * The unified Tool interface that the dispatcher interacts with.
 */
export interface Tool<TInput = any, TOutput = any> {
  name: string;
  description: string;
  category: ToolCategory;
  parameters: z.ZodType<TInput>;
  execute: (input: TInput, context: ToolExecutionContext) => Promise<ToolResult<TOutput>>;
}

/**
 * Configuration for defining a native tool.
 */
export interface NativeToolConfig<TInput, TOutput> {
  name: string;
  description: string;
  category: ToolCategory;
  parameters: z.ZodType<TInput>;
  execute: (input: TInput, context: ToolExecutionContext) => Promise<TOutput>;
}

/**
 * Where the tool originated from.
 */
export type ToolSource =
  | { type: 'native' }
  | { type: 'mcp'; serverName: string };
