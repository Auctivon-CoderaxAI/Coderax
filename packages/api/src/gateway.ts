/**
 * Subpath entry for the WorkflowEngine gateway.
 *
 * It is built separately from the API barrel so the gateway stays isolated from
 * the main package surface. The barrel is not modified.
 */
export * from './gateway/index';
