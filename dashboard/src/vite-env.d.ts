/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTOMATION_URL?: string
  readonly VITE_PERCEPTION_URL?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
