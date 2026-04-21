import { describe, it, expect, beforeEach } from 'vitest'
import { useSessionsStore } from './sessions'

function reset() {
  useSessionsStore.setState({ sessions: [], activeId: null })
}

beforeEach(reset)

describe('addSession', () => {
  it('appends a session and makes it active', () => {
    const id = useSessionsStore.getState().addSession('/path/to/repo', 'hi')
    const { sessions, activeId } = useSessionsStore.getState()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe(id)
    expect(sessions[0].firstPrompt).toBe('hi')
    expect(activeId).toBe(id)
  })

  it('derives label from cwd basename when none is provided', () => {
    useSessionsStore.getState().addSession('/Users/me/projects/alpha')
    expect(useSessionsStore.getState().sessions[0].label).toBe('alpha')
  })

  it('uses the explicit label when given', () => {
    useSessionsStore.getState().addSession('/x/y', '', 'Custom')
    expect(useSessionsStore.getState().sessions[0].label).toBe('Custom')
  })

  it('defaults type to claude and pinned to false', () => {
    useSessionsStore.getState().addSession('/x')
    const s = useSessionsStore.getState().sessions[0]
    expect(s.type).toBe('claude')
    expect(s.pinned).toBe(false)
    expect(s.status).toBe('running')
  })
})

describe('removeSession', () => {
  it('leaves activeId unchanged when removing a non-active session', () => {
    const store = useSessionsStore.getState()
    const a = store.addSession('/a')
    const b = store.addSession('/b')
    useSessionsStore.getState().setActive(a)
    useSessionsStore.getState().removeSession(b)
    expect(useSessionsStore.getState().activeId).toBe(a)
    expect(useSessionsStore.getState().sessions.map(s => s.id)).toEqual([a])
  })

  it('after removing the active session, activeId moves to the neighbor at the same index', () => {
    const store = useSessionsStore.getState()
    const a = store.addSession('/a')
    const b = store.addSession('/b')
    const c = store.addSession('/c')
    useSessionsStore.getState().setActive(b)
    useSessionsStore.getState().removeSession(b)
    expect(useSessionsStore.getState().activeId).toBe(c)
    void a
  })

  it('after removing the last session, activeId clamps to the previous index', () => {
    const store = useSessionsStore.getState()
    const a = store.addSession('/a')
    const b = store.addSession('/b')
    useSessionsStore.getState().setActive(b)
    useSessionsStore.getState().removeSession(b)
    expect(useSessionsStore.getState().activeId).toBe(a)
  })

  it('sets activeId to null when the only session is removed', () => {
    const id = useSessionsStore.getState().addSession('/only')
    useSessionsStore.getState().removeSession(id)
    expect(useSessionsStore.getState().activeId).toBeNull()
    expect(useSessionsStore.getState().sessions).toHaveLength(0)
  })
})

describe('reorderSession', () => {
  it('moves a forward past its neighbor (insert-before-index semantics)', () => {
    const store = useSessionsStore.getState()
    const a = store.addSession('/a')
    const b = store.addSession('/b')
    const c = store.addSession('/c')
    useSessionsStore.getState().reorderSession(a, 2)
    // reorder(a, 2) on [a,b,c]: from=0, target=2, post-splice insert index = 2-1 = 1 → [b, a, c]
    expect(useSessionsStore.getState().sessions.map(s => s.id)).toEqual([b, a, c])
    void c
  })

  it('moves a session all the way to the end', () => {
    const store = useSessionsStore.getState()
    const a = store.addSession('/a')
    const b = store.addSession('/b')
    const c = store.addSession('/c')
    useSessionsStore.getState().reorderSession(a, 3)
    expect(useSessionsStore.getState().sessions.map(s => s.id)).toEqual([b, c, a])
  })

  it('moves a session backward', () => {
    const store = useSessionsStore.getState()
    const a = store.addSession('/a')
    const b = store.addSession('/b')
    const c = store.addSession('/c')
    useSessionsStore.getState().reorderSession(c, 0)
    expect(useSessionsStore.getState().sessions.map(s => s.id)).toEqual([c, a, b])
  })

  it('is a no-op when from === to', () => {
    const store = useSessionsStore.getState()
    const a = store.addSession('/a')
    const b = store.addSession('/b')
    const before = useSessionsStore.getState().sessions
    useSessionsStore.getState().reorderSession(a, 0)
    expect(useSessionsStore.getState().sessions).toBe(before)
    void b
  })

  it('ignores unknown ids', () => {
    useSessionsStore.getState().addSession('/a')
    const before = useSessionsStore.getState().sessions
    useSessionsStore.getState().reorderSession('not-a-real-id', 0)
    expect(useSessionsStore.getState().sessions).toBe(before)
  })
})

describe('status mutators', () => {
  it('markRunning / markWaiting mutate only the target session', () => {
    const store = useSessionsStore.getState()
    const a = store.addSession('/a')
    const b = store.addSession('/b')
    useSessionsStore.getState().markWaiting(a)
    let state = useSessionsStore.getState()
    expect(state.sessions.find(s => s.id === a)!.status).toBe('waiting')
    expect(state.sessions.find(s => s.id === b)!.status).toBe('running')
    useSessionsStore.getState().markRunning(a)
    state = useSessionsStore.getState()
    expect(state.sessions.find(s => s.id === a)!.status).toBe('running')
  })

  it('renameSession updates only the target label', () => {
    const store = useSessionsStore.getState()
    const a = store.addSession('/a')
    const b = store.addSession('/b')
    useSessionsStore.getState().renameSession(a, 'alpha')
    const state = useSessionsStore.getState()
    expect(state.sessions.find(s => s.id === a)!.label).toBe('alpha')
    expect(state.sessions.find(s => s.id === b)!.label).toBe('b')
  })

  it('togglePin flips the target pinned flag', () => {
    const id = useSessionsStore.getState().addSession('/a')
    useSessionsStore.getState().togglePin(id)
    expect(useSessionsStore.getState().sessions[0].pinned).toBe(true)
    useSessionsStore.getState().togglePin(id)
    expect(useSessionsStore.getState().sessions[0].pinned).toBe(false)
  })
})

describe('setFirstPrompt / setUserHasTyped', () => {
  it('setFirstPrompt does not overwrite an existing firstPrompt', () => {
    const id = useSessionsStore.getState().addSession('/a', 'original')
    useSessionsStore.getState().setFirstPrompt(id, 'replacement')
    expect(useSessionsStore.getState().sessions[0].firstPrompt).toBe('original')
  })

  it('setFirstPrompt sets an initially-empty prompt', () => {
    const id = useSessionsStore.getState().addSession('/a')
    useSessionsStore.getState().setFirstPrompt(id, 'hello')
    expect(useSessionsStore.getState().sessions[0].firstPrompt).toBe('hello')
  })

  it('setUserHasTyped is idempotent', () => {
    const id = useSessionsStore.getState().addSession('/a')
    useSessionsStore.getState().setUserHasTyped(id)
    const first = useSessionsStore.getState().sessions[0]
    useSessionsStore.getState().setUserHasTyped(id)
    const second = useSessionsStore.getState().sessions[0]
    expect(first.userHasTyped).toBe(true)
    expect(second.userHasTyped).toBe(true)
    // Object identity is preserved on the idempotent second call (guard against unnecessary re-renders).
    expect(second).toBe(first)
  })
})

describe('aiTitle', () => {
  it('setAiTitle sets the title, clearAiTitle removes it', () => {
    const id = useSessionsStore.getState().addSession('/a')
    useSessionsStore.getState().setAiTitle(id, 'My Title')
    expect(useSessionsStore.getState().sessions[0].aiTitle).toBe('My Title')
    useSessionsStore.getState().clearAiTitle(id)
    expect(useSessionsStore.getState().sessions[0].aiTitle).toBeUndefined()
  })
})
