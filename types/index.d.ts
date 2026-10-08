export type StepperChangeKind = 'new' | 'edit'

export type StepperChange = {
  id: string
  turnId: string
  request: string
  path: string
  file: string
  folder: string
  kind: StepperChangeKind
  added: number
  removed: number
  line: number | null
  diff: string
  isDiffCut: boolean
}

declare module 'claude-code' {
  interface PluginState {
    stepper: {
      changes: StepperChange[]
      selectedId: string | null
      isOpen: boolean
      explanations: Record<string, string>
      explainingId: string | null
    }
  }
}
