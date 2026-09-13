import type { MimemaAutomation } from "./automation.ts"

declare global {
  interface Window {
    /** installed by main.tsx — see client/automation.ts */
    __mimema: MimemaAutomation
  }
}

export {}
