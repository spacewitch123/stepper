import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { StepperChange } from '../types'
import { dots, firstOfLatest, MAX_CHANGES, requestLabel, step, toChange, turnsOf } from './stepper-core'
import type { Hunk } from './stepper-core'

type Engine = EngineInterface

const PANE = 'stepper'
const TITLE = 'Changes'

const ACCENT = '#8b5cf6'
const NEW = '#10b981'
const ADDED = '#16a34a'
const REMOVED = '#e11d48'

const changesAtom = atom({ plugin: 'stepper', key: 'changes' } as const, [])
const selectedAtom = atom({ plugin: 'stepper', key: 'selectedId' } as const, null)
const openAtom = atom({ plugin: 'stepper', key: 'isOpen' } as const, false)
const explanationsAtom = atom({ plugin: 'stepper', key: 'explanations' } as const, {})
const explainingAtom = atom({ plugin: 'stepper', key: 'explainingId' } as const, null)

// The request each change belongs to; a reload starts it over.
let turn = { id: 'earlier', request: 'An earlier request' }

async function openStepper($: Engine): Promise<boolean> {
  const changes = await read($, changesAtom)
  await update($, selectedAtom, () => firstOfLatest(changes))
  const opened = await $.ui.open({ id: PANE, title: TITLE, focus: true })

  if (opened.isPlaced) {
    await update($, openAtom, () => true)
  }

  return opened.isPlaced
}

async function move($: Engine, by: number): Promise<void> {
  const changes = await read($, changesAtom)
  await update($, selectedAtom, id => step(changes, id, by))
}

async function explain($: Engine, change: StepperChange): Promise<void> {
  if ((await read($, explainingAtom)) !== null) {
    return
  }

  await update($, explainingAtom, () => change.id)

  try {
    const answer = await $.model.complete({
      model: 'haiku',
      maxTokens: 120,
      system: 'You explain code changes to people who are not programmers.',
      prompt: `This change was made to ${change.file}${change.isDiffCut ? ' (diff shortened)' : ''}:\n\n${change.diff.slice(0, 6000)}\n\nIn one or two short sentences of plain English, say what this change does and why it might matter. No code, no file names, no jargon.`,
    })
    const text = answer.isAnswered ? answer.text.trim() : "Couldn't explain this one right now. Try again in a moment."
    await update($, explanationsAtom, all => ({ ...all, [change.id]: text }))
  } finally {
    await update($, explainingAtom, () => null)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'changes',
      description: 'Step through the changes Claude made, one at a time',
      argumentHint: '[clear]',
      immediate: true,
    })

    return started
  })

  on('command.run', { command: 'changes' }, async ($, e) => {
    if (e.args.trim().toLowerCase() === 'clear') {
      await update($, changesAtom, () => [])
      await update($, selectedAtom, () => null)
      await update($, explanationsAtom, () => ({}))

      return { text: 'Cleared the list of changes.' }
    }

    if ((await read($, changesAtom)).length === 0) {
      return { text: 'Claude has not changed any files in this session yet.' }
    }

    const isOpen = await openStepper($)

    return { text: isOpen ? 'Stepping through the changes. Press n for next, p for previous.' : 'Widen the window to see the changes.' }
  })

  on('turn.start', async ($, e, next) => {
    const text = e.text.trim()

    if (text !== '' && !text.startsWith('/')) {
      turn = { id: e.turnId, request: requestLabel(text) }
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)

    if (ran.deny !== undefined || ran.isError === true || (e.tool !== 'Edit' && e.tool !== 'Write')) {
      return ran
    }

    const record = ran.result as
      | { filePath?: string; structuredPatch?: Hunk[]; type?: string; content?: string; staged?: boolean }
      | undefined

    if (record?.filePath === undefined || record.staged === true) {
      return ran
    }

    const change = toChange(String(e.tool_use_id), turn.id, turn.request, {
      filePath: record.filePath,
      structuredPatch: record.structuredPatch ?? [],
      kind: e.tool === 'Write' && record.type === 'create' ? 'new' : 'edit',
      content: record.content,
    })

    if (change.added + change.removed > 0) {
      await update($, changesAtom, all => [...all, change].slice(-MAX_CHANGES))
    }

    return ran
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    await update($, openAtom, () => false)

    return next(e)
  })

  // A one-line nudge in the band after Claude changes files.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const changes = await read($, changesAtom)
    const last = changes[changes.length - 1]

    if (e.props.hasSurvey || last === undefined || (await read($, openAtom))) {
      return below
    }

    const { Box, Text, Button } = $.ui.resolve(e)
    const latest = changes.filter(c => c.turnId === last.turnId)
    const label = `✎ ${latest.length} ${latest.length === 1 ? 'change' : 'changes'} in your last request  `
    const room = Math.max(3, e.props.bodyColumns - label.length - 22)
    const marks = dots(latest, null, room)

    const row = (
      <Box flexDirection="row">
        <Text color={ACCENT} bold>
          {label}
        </Text>
        {marks.map(m =>
          m.type === 'more' ? (
            <Text dimColor>{` +${m.count} `}</Text>
          ) : (
            <Text color={m.kind === 'new' ? NEW : ACCENT}>{'● '}</Text>
          ),
        )}
        <Text> </Text>
        <Button key="stepper-open" label="Step through" onPress={() => openStepper($)} />
      </Box>
    )

    if (below.type === 'engine') {
      return row
    }

    return (
      <Box flexDirection="column">
        {row}
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Code } = $.ui.resolve(e)
    const changes = await read($, changesAtom)
    const selectedId = await read($, selectedAtom)
    const explanations = await read($, explanationsAtom)
    const explainingId = await read($, explainingAtom)
    const change = changes.find(c => c.id === selectedId) ?? changes[changes.length - 1]
    const columns = Math.max(20, e.props.bodyColumns)

    if (change === undefined) {
      return <Text dimColor>No changes yet. They show up here as Claude edits files.</Text>
    }

    const turns = turnsOf(changes)
    const group = changes.filter(c => c.turnId === change.turnId)
    const position = group.findIndex(c => c.id === change.id) + 1
    const counter = `Change ${position} of ${group.length}`
    const request = `Request ${turns.indexOf(change.turnId) + 1} of ${turns.length} · ${change.request}`
    const requestWidth = Math.max(4, columns - counter.length - 2)
    const marks = dots(group, change.id, Math.floor(columns / 3))
    const explanation = explanations[change.id]

    const header: RenderElement = (
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold wrap="truncate-end">
          {request.length > requestWidth ? `${request.slice(0, requestWidth - 1)}…` : request}
        </Text>
        <Text dimColor>{counter}</Text>
      </Box>
    )

    const dotsRow: RenderElement = (
      <Box flexDirection="row" marginTop={1}>
        {marks.map(m =>
          m.type === 'more' ? (
            <Text dimColor>{`+${m.count}  `}</Text>
          ) : m.isCurrent ? (
            <Text color={m.kind === 'new' ? NEW : ACCENT} bold>
              {'●  '}
            </Text>
          ) : (
            <Text color={m.kind === 'new' ? NEW : undefined} dimColor={m.kind !== 'new'}>
              {'○  '}
            </Text>
          ),
        )}
      </Box>
    )

    const what: RenderElement = (
      <Box flexDirection="row" marginTop={1}>
        <Text color={change.kind === 'new' ? NEW : ACCENT} bold>
          {change.kind === 'new' ? '✚ New file  ' : '✎ Edited  '}
        </Text>
        <Text bold>{change.file}</Text>
        <Text dimColor>{change.folder === '' ? '' : `  ${change.folder}`}</Text>
        <Text dimColor>{change.line === null || change.kind === 'new' ? '' : `  · line ${change.line}`}</Text>
        <Text dimColor>{'  · '}</Text>
        <Text color={ADDED}>{`+${change.added}`}</Text>
        <Text> </Text>
        <Text color={REMOVED}>{`−${change.removed}`}</Text>
      </Box>
    )

    const controls: RenderElement = (
      <Box flexDirection="row" marginTop={1}>
        <Button key="stepper-prev" label="‹ Prev" hotkey="p" onPress={() => move($, -1)} />
        <Text> </Text>
        <Button
          key="stepper-next"
          label="Next ›"
          hotkey="n"
          variant="primary"
          onPress={() => move($, 1)}
        />
        <Text> </Text>
        <Button key="stepper-explain" label="Explain" hotkey="e" onPress={() => explain($, change)} />
      </Box>
    )

    const plain: RenderElement | null =
      explainingId === change.id ? (
        <Text dimColor italic>
          Explaining…
        </Text>
      ) : explanation !== undefined ? (
        <Text italic>{explanation}</Text>
      ) : null

    return (
      <Box flexDirection="column">
        {header}
        {dotsRow}
        {what}
        {controls}
        {plain === null ? [] : [<Box marginTop={1}>{plain}</Box>]}
        <Box marginTop={1}>
          <Code source={change.diff} format="diff" path={change.path} wrap="truncate-end" />
        </Box>
        {change.isDiffCut ? [<Text dimColor>Only the first part of this change is shown.</Text>] : []}
      </Box>
    )
  })
}
