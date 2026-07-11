/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTOMATION_URL?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
