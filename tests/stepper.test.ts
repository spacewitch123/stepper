import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { dots, renderDiff, toChange } from '../hooks/stepper-core'

const SURFACES = ['terminal', 'desktop'] as const

const PANE = {
  plugin: 'stepper',
  component: 'Pane',
  requestId: 'stepper',
  props: {
    title: 'Changes',
    isFocused: true,
    bodyColumns: 90,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const BAND = {
  plugin: 'stepper',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 19 }, view: {} },
} as const

function world(on: On) {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }))
  on('model.complete', () => ({
    value: {
      isAnswered: true,
      text: 'Adds a yearly price option so visitors can save by paying once a year.',
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  }))
  on('tool.call', ($, e) => {
    if (e.tool === 'Write') {
      return { result: { type: 'create', filePath: e.file_path, content: e.content, structuredPatch: [], originalFile: null } }
    }

    if (e.tool === 'Edit' && e.old_string === 'FAIL') {
      return { result: 'String to replace not found in file.', isError: true } as never
    }

    if (e.tool === 'Edit') {
      return {
        result: {
          filePath: e.file_path,
          oldString: e.old_string,
          newString: e.new_string,
          originalFile: '',
          userModified: false,
          replaceAll: false,
          structuredPatch: [
            { oldStart: 41, oldLines: 2, newStart: 41, newLines: 3, lines: [' <Price />', `-${e.old_string}`, `+${e.new_string}`, '+<Yearly />'] },
          ],
        },
      }
    }

    return { result: { ok: true } }
  })
}

async function makeChanges($: Engine) {
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'Add a yearly plan to the pricing page', turnId: 'turn-1' })
  await $.tool.call({ tool: 'Write', file_path: '/app/src/components/Yearly.tsx', content: 'export const Yearly = () => null\n' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/app/src/components/Pricing.tsx', old_string: 'monthly', new_string: 'yearly' } as never)
  await $.tool.call({ tool: 'Bash', command: 'ls', description: 'list' } as never)
}

async function texts(ui: { findAll: (q: { type: string }) => Promise<Array<{ text?: string }>> }) {
  return (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '').join('')
}

test('diffs stay parseable when cut, and dots window around the current change', () => {
  const big = { oldStart: 1, oldLines: 400, newStart: 1, newLines: 400, lines: Array.from({ length: 400 }, (_, i) => (i % 2 ? `+a${i}` : ` b${i}`)) }
  const cut = renderDiff([big])
  expect(cut.isCut).toBe(true)
  expect(cut.diff.startsWith('@@ -1,150 +1,300 @@')).toBe(true)

  const many = Array.from({ length: 20 }, (_, i) => toChange(`c${i}`, 't', 'r', { filePath: `/x/f${i}.ts`, structuredPatch: [], kind: 'new', content: 'x' }))
  const marks = dots(many, 'c10', 7)
  expect(marks).toHaveLength(7)
  expect(marks[0]).toEqual({ type: 'more', count: 8 })
  expect(marks.some(m => m.type === 'dot' && m.isCurrent && m.id === 'c10')).toBe(true)
})

test('the band counts the last request\'s changes and opens the stepper', async ($, on) => {
  world(on)
  await makeChanges($)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await texts(ui)).toMatch(/✎ 2 changes in your last request/)
    expect(await ui.find({ key: 'stepper-open' })).toBeDefined()
    await ui.unmount()
  }
})

test('the stepper pages through changes with dots, details and the diff', async ($, on) => {
  world(on)
  await makeChanges($)
  const opened = await $.command.run({ command: 'changes', args: '' } as never)
  expect(opened.text).toMatch(/Stepping through/)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    let all = await texts(ui)
    expect(all).toMatch(/Request 1 of 1 · Add a yearly plan to the pricing page/)
    expect(all).toMatch(/Change 1 of 2/)
    expect(all).toMatch(/✚ New file  Yearly\.tsx  src\/components/)
    expect(all).toMatch(/●  ○/)

    await ui.press({ key: 'stepper-next' })
    all = await texts(ui)
    expect(all).toMatch(/Change 2 of 2/)
    expect(all).toMatch(/✎ Edited  Pricing\.tsx  src\/components  · line 41/)
    expect(all).toMatch(/\+2 −1/)
    expect(all).toMatch(/○  ●/)
    expect(JSON.stringify(await ui.drawn())).toMatch(/"format":"diff"/)

    await ui.press({ key: 'stepper-explain' })
    expect(await texts(ui)).toMatch(/yearly price option/)

    await ui.press({ key: 'stepper-prev' })
    expect(await texts(ui)).toMatch(/Change 1 of 2/)
    await ui.unmount()
  }
})

test('failed edits are not counted and /changes clear empties the list', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'Fix it', turnId: 'turn-9' })
  await $.tool.call({ tool: 'Edit', file_path: '/a/b.ts', old_string: 'FAIL', new_string: 'y' } as never)
  expect((await $.command.run({ command: 'changes', args: '' } as never)).text).toMatch(/not changed any files/)

  await $.tool.call({ tool: 'Write', file_path: '/a/new.ts', content: 'hi\n' } as never)
  expect((await $.command.run({ command: 'changes', args: 'clear' } as never)).text).toMatch(/Cleared/)
  expect((await $.command.run({ command: 'changes', args: '' } as never)).text).toMatch(/not changed any files/)
})
