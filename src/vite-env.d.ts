/// <reference types="vite/client" />

interface Window {
  __READY__: boolean
  __LAST_ERROR__: string | null
  render_state_to_text: () => string
  step: (ms: number) => string
}
