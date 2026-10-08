// Turning a tool's record of an edit into one step, and the arithmetic of
// paging through steps. Pure, so the tests can hold it to exact values.

import type { StepperChange, StepperChangeKind } from '../types'

export const MAX_CHANGES = 200
export const MAX_DIFF_LINES = 300

export type Hunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: readonly string[]
}

export type EditRecord = {
  filePath: string
  structuredPatch: readonly Hunk[]
  kind: StepperChangeKind
  content?: string
}

function header(h: Hunk): string {
  return `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`
}

function cutHunk(h: Hunk, keep: number): Hunk {
  const lines = h.lines.slice(0, keep)

  return {
    ...h,
    lines,
    oldLines: lines.filter(l => !l.startsWith('+')).length,
    newLines: lines.filter(l => !l.startsWith('-')).length,
  }
}

// Whole hunks up to the line budget; a first hunk over it is cut and its
// header recounted, so the diff always parses.
export function renderDiff(hunks: readonly Hunk[]): { diff: string; isCut: boolean } {
  const kept: Hunk[] = []
  let used = 0

  for (const h of hunks) {
    if (used + h.lines.length <= MAX_DIFF_LINES) {
      kept.push(h)
      used += h.lines.length
      continue
    }

    if (kept.length === 0) {
      kept.push(cutHunk(h, MAX_DIFF_LINES))
    }

    return { diff: kept.map(k => [header(k), ...k.lines].join('\n')).join('\n'), isCut: true }
  }

  return { diff: kept.map(k => [header(k), ...k.lines].join('\n')).join('\n'), isCut: false }
}

export function hunksForNewFile(content: string): Hunk[] {
  const lines = content.replace(/\n$/, '').split('\n')

  return content === '' ? [] : [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: lines.length, lines: lines.map(l => `+${l}`) }]
}

export function splitPath(path: string): { file: string; folder: string } {
  const parts = path.split('/').filter(Boolean)
  const file = parts.pop() ?? path

  return { file, folder: parts.slice(-2).join('/') }
}

export function requestLabel(text: string): string {
  const first = (text.split('\n').find(l => l.trim() !== '') ?? '').replace(/\s+/g, ' ').trim()

  if (first === '') {
    return 'Your request'
  }

  if (first.length <= 48) {
    return first
  }

  const cut = first.slice(0, 47)
  const space = cut.lastIndexOf(' ')

  return `${space > 20 ? cut.slice(0, space) : cut}…`
}

export function toChange(id: string, turnId: string, request: string, record: EditRecord): StepperChange {
  const hunks = record.kind === 'new' && record.structuredPatch.length === 0 ? hunksForNewFile(record.content ?? '') : record.structuredPatch
  const all = hunks.flatMap(h => h.lines)
  const { diff, isCut } = renderDiff(hunks)
  const { file, folder } = splitPath(record.filePath)
  const first = hunks[0]

  return {
    id,
    turnId,
    request,
    path: record.filePath,
    file,
    folder,
    kind: record.kind,
    added: all.filter(l => l.startsWith('+')).length,
    removed: all.filter(l => l.startsWith('-')).length,
    line: first === undefined ? null : Math.max(1, first.newStart),
    diff,
    isDiffCut: isCut,
  }
}

// One mark in the dots row: a change, or how many sit off either end.
export type Dot = { type: 'dot'; id: string; isCurrent: boolean; kind: StepperChangeKind } | { type: 'more'; count: number }

export function dots(group: readonly StepperChange[], currentId: string | null, slots: number): Dot[] {
  const room = Math.max(3, slots)
  const index = Math.max(0, group.findIndex(c => c.id === currentId))
  const toDot = (c: StepperChange): Dot => ({ type: 'dot', id: c.id, isCurrent: c.id === currentId, kind: c.kind })

  if (group.length <= room) {
    return group.map(toDot)
  }

  const inner = room - 2
  const start = Math.min(Math.max(0, index - Math.floor(inner / 2)), group.length - inner)
  const end = start + inner
  const marks: Dot[] = group.slice(start, end).map(toDot)

  if (start > 0) {
    marks.unshift({ type: 'more', count: start })
  }

  if (end < group.length) {
    marks.push({ type: 'more', count: group.length - end })
  }

  return marks
}

export function turnsOf(changes: readonly StepperChange[]): string[] {
  return changes.reduce<string[]>((turns, c) => (turns.includes(c.turnId) ? turns : [...turns, c.turnId]), [])
}

export function step(changes: readonly StepperChange[], currentId: string | null, by: number): string | null {
  if (changes.length === 0) {
    return null
  }

  const index = changes.findIndex(c => c.id === currentId)
  const next = Math.max(0, Math.min(changes.length - 1, (index < 0 ? 0 : index) + by))

  return changes[next]?.id ?? null
}

export function firstOfLatest(changes: readonly StepperChange[]): string | null {
  const last = changes[changes.length - 1]

  return last === undefined ? null : (changes.find(c => c.turnId === last.turnId)?.id ?? null)
}
