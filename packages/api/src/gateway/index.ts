/**
 * Authenticated server-side gateway between Coderax and Coderax-WorkflowEngine.
 *
 * Coderax owns the web interface, authentication and presentation. The engine
 * owns intelligence, orchestration, model routing, execution, memory and
 * authoritative task state. This module is the only place in Coderax that holds
 * the engine credential, and every operation it exposes is validated against the
 * engine's published contract in both directions.
 */
export * from './contracts';
export * from './config';
export * from './owner';
export * from './errors';
export * from './transport';
export * from './service';
export * from './negotiation';
export * from './handlers';
export type {
  EngineCall,
  EngineHttpClient,
  EngineJsonResponse,
  EngineResponse,
  EngineStreamResponse,
  HttpClientOptions,
} from './client';
export { createHttpEngineClient, readSseData } from './client';
