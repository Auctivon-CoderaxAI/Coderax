/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_LOGGER: string;
  readonly VITE_LOGGER_FILTER: string;
  readonly VITE_FLAT_THREAD: string;
  /** Direct VM origin for long OpenCode Work streams; unset uses the Vercel route. */
  readonly VITE_WORK_ENGINE_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
