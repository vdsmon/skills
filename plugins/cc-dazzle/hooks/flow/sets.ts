// The diagrams the drawer's checks run over, and the widths they run at.

import { CORPUS } from './corpus'

export const WIDTHS = [60, 80, 100, 120, 160]

/** State diagrams written for the checks: composite states, nested ones, and edges across frames. */
export const STATES: Record<string, string> = {
  plain: `stateDiagram-v2
    [*] --> Idle
    Idle --> Running : start
    Running --> Idle : stop
    Running --> Done : finish all the queued work
    Done --> [*]`,
  composite: `stateDiagram-v2
    [*] --> Ready
    Ready --> Active : open the session
    state Active {
      [*] --> Working
      Working --> Paused : pause
      Paused --> Working : resume
    }
    Active --> Closed : close
    Paused --> Closed : give up while paused
    Closed --> [*]`,
  nested: `stateDiagram-v2
    [*] --> Outer
    state Outer {
      [*] --> First
      First --> Inner
      state Inner {
        [*] --> Deep
        Deep --> Deeper : go further down
        Deeper --> [*]
      }
      Inner --> Last
    }
    Deeper --> First : climb back to the top of the outer state
    Last --> Elsewhere : leave both frames
    Elsewhere --> Deep : jump straight into the inner state`,
  named: `stateDiagram-v2
    state "Waiting for the reviewer to read the whole change" as Waiting {
      Unread --> Reading : opens it
      Reading --> Unread : closes the tab
    }
    state "Merged into the main branch" as Merged
    [*] --> Unread
    Reading --> Merged : approves
    Merged --> [*]`,
  shapes: `stateDiagram-v2
    state check <<choice>>
    state split <<fork>>
    state meet <<join>>
    [*] --> check
    check --> Small : under the limit
    check --> split : over the limit
    split --> Left
    split --> Right
    Left --> meet
    Right --> meet
    meet --> Small
    note right of Small : a note beside a state
    note left of Left
      a note over
      several lines
    end note
    Small --> Small : retry once more before giving up
    Small --> [*]`,
  concurrent: `stateDiagram-v2
    [*] --> Both
    state Both {
      [*] --> NumLock
      NumLock --> CapsLock : press
      --
      [*] --> ScrollOn
      ScrollOn --> ScrollOff : press again
    }
    Both --> [*]`,
  empty: `stateDiagram-v2
    state Lonely {
    }
    [*] --> Lonely
    Lonely --> Gone`,
}

/**
 * Flowcharts whose edges meet frames every way they can: into and out of frames, across sibling
 * frames, two frames deep, back up across a border, from a frame to a box inside it and back, and
 * looping on a box inside a frame and on a frame.
 */
export const FRAMES: Record<string, string> = {
  siblings: `flowchart TD
    subgraph S[Stage one]
      A[Start] --> B[Middle]
    end
    subgraph T[Stage two]
      C[Check] --> D[Done]
    end
    B -->|hand over the work| C
    D -->|send it back to the start| A
    A -->|once more| A
    T --> T
    S --> D
    B --> T
    A --> X[Outside]
    X --> B
    X --> C`,
  deep: `flowchart TD
    subgraph O[Outer]
      subgraph M[Middle]
        subgraph I[Inner]
          P[Deep one] --> Q[Deep two]
        end
      end
      K[Keeper]
    end
    R[Root] -->|all the way in| P
    Q -->|all the way out| Z[Leaf]
    Z -.-> P
    K --> Q
    O --> M
    Q --> O
    M --> K`,
}

/**
 * The diagrams of cc-dazzle's old back-edge tests, which beautiful-mermaid drew with its patches:
 * each must still draw. The first of those tests drew corpus 2's shape, which the corpus covers.
 */
export const RETURNS: string[] = [
  'flowchart TD\n  A[Alpha] --> B[Beta] --> C[Gamma]\n  C -->|retry| A',
  'flowchart LR\n  A --> B\n  B -->|one| A\n  B -->|two| A',
  'graph TD\n  A --> B\n  B --> C\n  C --> A\n  C --> D\n  D --> B',
  'flowchart TD\n  A[Start] --> B{OK?}\n  B -->|yes| C[Ship]\n  B -->|no| D[Fix]\n  D --> B',
  'flowchart LR\n  A --> B --> C\n  C --> A\n  C -.-> B\n  B ==> A',
  'flowchart LR\n  A[Alpha] --> B[Beta]\n  B -->|again| B',
  'flowchart LR\n  A[Alpha] --> B[Beta] --> C[Gamma]\n  B -->|again| B',
  'flowchart LR\n  subgraph one[First]\n    A[Alpha] --> B[Beta]\n    B -->|again| A\n  end\n  B --> C[Gamma]',
  'flowchart LR\n  A --> B --> C\n  A --> D\n  C --> D',
  'flowchart LR\n  subgraph one[First]\n    A[Alpha] --> B[Beta]\n  end\n  B --> C[Gamma]',
  'flowchart LR\n  Q[Queue] --> A[One] & B[Two] & C[Three]\n  A & B & C --> D[Done]',
  'flowchart TD\n  A --> B\n  B --> A\n  B --> C',
]

/** A fixed-seed generator, so the random graphs are the same on every run. */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const SYLLABLES = ['ka', 'lo', 'mi', 'ne', 'su', 'ta', 'vo', 'ri', 'de', 'po', 'zu', 'fa', 'gi', 'be', 'no']
const SHAPES: [string, string][] = [['[', ']'], ['(', ')'], ['{', '}'], ['([', '])'], ['[[', ']]']]
const LINKS = ['-->', '-.->', '==>', '---', '<-->', 'o--o', 'x--x']

/**
 * 200 flowcharts: 2 to 12 boxes, up to boxes + 3 edges, up to 4 of them back edges or self-loops,
 * about half the edges labelled, every label of 1 to 8 words, some words long enough to break. Up to
 * 3 frames, nested up to two deep, hold about half the boxes; an edge may start or end on a frame,
 * repeat the edge before it between the same two ends, or carry a head at both ends.
 */
export const RANDOM: string[] = (() => {
  const random = seeded(20261115)
  const int = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1))
  const pick = <T,>(list: T[]) => list[int(0, list.length - 1)]!
  const word = () => {
    const long = random() < 0.05
    const parts = Array.from({ length: long ? int(6, 12) : int(1, 4) }, () => pick(SYLLABLES))
    return long && random() < 0.5 ? parts.join('').replace(/(.{6})/g, '$1-').replace(/-$/, '') : parts.join('')
  }
  const label = () => Array.from({ length: int(1, 8) }, word).join(' ')
  return Array.from({ length: 200 }, () => {
    const boxes = int(2, 12)
    const edges = int(1, boxes + 3)
    const returns = int(0, Math.min(4, edges))
    const frames = random() < 0.5 ? 0 : int(1, 3)
    // A frame sits at the top or inside an earlier frame that is itself at the top: two deep at most.
    const parent = Array.from({ length: frames }, (_, f) => (f > 0 && random() < 0.4 ? int(0, f - 1) : -1))
    for (let f = 0; f < frames; f++) if (parent[f]! >= 0 && parent[parent[f]!]! >= 0) parent[f] = parent[parent[f]!]!
    const home = Array.from({ length: boxes }, () => (frames > 0 && random() < 0.5 ? int(0, frames - 1) : -1))
    const box = (i: number) => {
      const [open, close] = pick(SHAPES)
      return `n${i}${open}"${label()}"${close}`
    }
    const lines = Array.from({ length: boxes }, (_, i) => i).filter(i => home[i] === -1).map(i => `  ${box(i)}`)
    const frame = (f: number, indent: string) => {
      lines.push(`${indent}subgraph s${f}["${label()}"]`)
      for (let i = 0; i < boxes; i++) if (home[i] === f) lines.push(`${indent}  ${box(i)}`)
      for (let g = 0; g < frames; g++) if (parent[g] === f) frame(g, `${indent}  `)
      lines.push(`${indent}end`)
    }
    for (let f = 0; f < frames; f++) if (parent[f] === -1) frame(f, '  ')
    const end = (i: number) => (frames > 0 && random() < 0.1 ? `s${int(0, frames - 1)}` : `n${i}`)
    let last = ''
    for (let k = 0; k < edges; k++) {
      let a = int(0, boxes - 1)
      let b = int(0, boxes - 1)
      if (k < returns) {
        if (a < b) [a, b] = [b, a]
      } else {
        if (a === b) b = (a + 1) % boxes
        if (a > b) [a, b] = [b, a]
      }
      const ends = k > 0 && random() < 0.15 ? last : `${end(a)} ${end(b)}`
      last = ends
      const [from, to] = ends.split(' ')
      const text = random() < 0.5 ? `|"${label()}"|` : ''
      lines.push(`  ${from} ${pick(LINKS)}${text} ${to}`)
    }
    return `flowchart TD\n${lines.join('\n')}`
  })
})()

/** Every diagram the checks run over, by name. */
export const DIAGRAMS: [string, string][] = [
  ...CORPUS.map((source, i): [string, string] => [`corpus ${i + 1}`, source]),
  ...Object.entries(STATES).map(([name, source]): [string, string] => [`state ${name}`, source]),
  ...Object.entries(FRAMES).map(([name, source]): [string, string] => [`frame ${name}`, source]),
  ...RETURNS.map((source, i): [string, string] => [`return ${i + 1}`, source]),
  ...RANDOM.map((source, i): [string, string] => [`random ${i + 1}`, source]),
]
