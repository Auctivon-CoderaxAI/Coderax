/**
 * Narrow runtime entry point for consumers that only need Mongoose model setup.
 * Keeping this separate from the package barrel avoids loading unrelated exports
 * while the Express backend is bootstrapping its database models.
 */
export { createModels } from './models/index';
