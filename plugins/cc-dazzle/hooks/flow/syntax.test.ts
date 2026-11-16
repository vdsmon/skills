import { expect, test } from 'claude-code/testing'

import type { Edge } from './graph'
import { parseFlow } from './parse'

// The parser held to Mermaid's own syntax, apart from the drawer: each form the flowchart and state
// diagram documentation lists, with the boxes, edges and frames Mermaid gives it. The drawer's checks
// read the source through this same parser, so they cannot see what it loses; this table can.

/**
 * What a source parses into: box labels in the order the boxes are first named, edges as
 * `from op to |label|` by id (`[*]` for a start or an end), frames as `outer/inner: their boxes`.
 */
const read = (source: string) => {
  const graph = parseFlow(source)
  if (graph === null) return null
  const id = (n: number) => (graph.ids[n]!.startsWith('[*]') ? '[*]' : graph.ids[n]!)
  const op = (e: Edge) => {
    const ends = { arrow: ['<', '>'], circle: ['o', 'o'], cross: ['x', 'x'], none: ['', ''] }
    const body = e.line === 'dotted' ? '-.-' : e.line === 'thick' ? '==' : '--'
    const fill = e.headTo !== 'none' || e.line === 'dotted' ? '' : body[0]
    return `${ends[e.headFrom][0]}${body}${fill}${ends[e.headTo][1]}`
  }
  const path = (g: number | null): string => (g === null ? '' : `${path(graph.groups[g]!.parent)}${graph.groups[g]!.parent === null ? '' : '/'}${graph.groups[g]!.label}`)
  return {
    boxes: graph.nodes.flatMap((node, n) => (graph.proxyOf(n) === undefined ? [node.label] : [])),
    edges: graph.edges.map(e => `${id(e.from)} ${op(e)} ${id(e.to)}${e.label === null ? '' : ` |${e.label}|`}`),
    frames: graph.groups.map((_, g) => `${path(g)}: ${graph.nodes.flatMap((_, n) => (graph.nodeGroup[n] === g && graph.proxyOf(n) === undefined ? [id(n)] : [])).join(' ')}`),
    warnings: graph.warnings,
  }
}

type Form = [name: string, source: string, boxes: string[], edges?: string[], frames?: string[]]

const FLOWCHART: Form[] = [
  ['a node', 'flowchart LR\n    id', ['id']],
  ['a node with text', 'flowchart LR\n    id1[This is the text in the box]', ['This is the text in the box']],
  ['unicode text', 'flowchart LR\n    id["This ❤ Unicode"]', ['This ❤ Unicode']],
  ['markdown strings, a newline breaking a line', 'flowchart LR\n    markdown["`This **is** _Markdown_`"]\n    newLines["`Line1\n    Line 2\n    Line 3`"]\n    markdown --> newLines', ['This is Markdown', 'Line1\nLine 2\nLine 3'], ['markdown --> newLines']],
  ['a title and config in front matter', '---\ntitle: Node\nconfig:\n  htmlLabels: false\n---\nflowchart LR\n    id', ['id']],
  ['an init directive', '%%{init: {"theme": "forest"}}%%\nflowchart TD\n    Start --> Stop', ['Start', 'Stop'], ['Start --> Stop']],
  ['every direction', 'flowchart TB\n  A --> B', ['A', 'B'], ['A --> B']],
  ...(
    [
      ['round edges', '(', ')'],
      ['a stadium', '([', '])'],
      ['a subroutine', '[[', ']]'],
      ['a cylinder', '[(', ')]'],
      ['a circle', '((', '))'],
      ['an asymmetric shape', '>', ']'],
      ['a rhombus', '{', '}'],
      ['a hexagon', '{{', '}}'],
      ['a parallelogram', '[/', '/]'],
      ['a parallelogram alt', '[\\', '\\]'],
      ['a trapezoid', '[/', '\\]'],
      ['a trapezoid alt', '[\\', '/]'],
      ['a double circle', '(((', ')))'],
    ] as const
  ).map(([shape, open, close]): Form => [`a node shaped as ${shape}`, `flowchart LR\n    id1${open}This is the text in the box${close} --> B`, ['This is the text in the box', 'B'], ['id1 --> B']]),
  ['the expanded shapes', 'flowchart RL\n    A@{ shape: manual-file, label: "File Handling"}\n    B@{ shape: rect, label: "This is a process" }\n    C@{ shape: circle }\n    A --> B', ['File Handling', 'This is a process', 'C'], ['A --> B']],
  ['an icon and an image shape', 'flowchart TD\n    A@{ icon: "fa:user", form: "square", label: "User Icon", pos: "t", h: 60 }\n    B@{ img: "https://mermaid.js.org/favicon.svg", label: "My example image label", pos: "t", h: 60, constraint: "on" }', ['User Icon', 'My example image label']],
  ['a link with an arrow head', 'flowchart LR\n    A-->B', ['A', 'B'], ['A --> B']],
  ['an open link', 'flowchart LR\n    A --- B', ['A', 'B'], ['A --- B']],
  ['text on an open link', 'flowchart LR\n    A-- This is the text! ---B\n    C---|This is the text|D', ['A', 'B', 'C', 'D'], ['A --- B |This is the text!|', 'C --- D |This is the text|']],
  ['text on an arrow', 'flowchart LR\n    A-->|text|B\n    C-- text -->D', ['A', 'B', 'C', 'D'], ['A --> B |text|', 'C --> D |text|']],
  ['a dotted link, with and without text', 'flowchart LR\n   A-.->B;\n   C-. text .-> D', ['A', 'B', 'C', 'D'], ['A -.-> B', 'C -.-> D |text|']],
  ['a thick link, with and without text', 'flowchart LR\n   A ==> B\n   C == text ==> D', ['A', 'B', 'C', 'D'], ['A ==> B', 'C ==> D |text|']],
  ['an invisible link joins two boxes and draws no edge', 'flowchart LR\n    A ~~~ B', ['A', 'B'], []],
  ['a chain of links', 'flowchart LR\n   A -- text --> B -- text2 --> C', ['A', 'B', 'C'], ['A --> B |text|', 'B --> C |text2|']],
  ['& in a chain', 'flowchart LR\n   a --> b & c--> d', ['a', 'b', 'c', 'd'], ['a --> b', 'a --> c', 'b --> d', 'c --> d']],
  ['& on both sides', 'flowchart TB\n    A & B--> C & D', ['A', 'B', 'C', 'D'], ['A --> C', 'A --> D', 'B --> C', 'B --> D']],
  ['edge ids and their settings', 'flowchart LR\n  A e1@==> B\n  A e2@--> C\n  Cache e3@-->|miss| DB\n  e1@{ animate: true }\n  e2@{ curve: natural }\n  classDef animate stroke-dasharray: 9\n  class e1 animate', ['A', 'B', 'C', 'Cache', 'DB'], ['A ==> B', 'A --> C', 'Cache --> DB |miss|']],
  ['circle and cross heads', 'flowchart LR\n    A --o B\n    B --x C', ['A', 'B', 'C'], ['A --o B', 'B --x C']],
  ['circle and cross heads written against the next name, which the documentation warns of', 'flowchart LR\n    A---oB\n    B---xC\n    dev--- ops', ['A', 'B', 'C', 'dev', 'ops'], ['A --o B', 'B --x C', 'dev --- ops']],
  ['a label given to a subgraph\'s id after it, which retitles its frame', 'flowchart TB\n    subgraph one [First title]\n    a1\n    end\n    one[Later title] --> a2', ['a1', 'a2'], ['one --> a2'], ['Later title: a1']],
  ['two-headed links', 'flowchart LR\n    A o--o B\n    B <--> C\n    C x--x D', ['A', 'B', 'C', 'D'], ['A o--o B', 'B <--> C', 'C x--x D']],
  ['longer links', 'flowchart TD\n    A[Start] --> B{Is it?}\n    B ---->|No| E[End]\n    B -- Yes ----> C[OK]\n    C ===> D\n    D -..-> A', ['Start', 'Is it?', 'End', 'OK', 'D'], ['A --> B', 'B --> E |No|', 'B --> C |Yes|', 'C ==> D', 'D -.-> A']],
  ['end and other words Mermaid reserves, capitalized as its documentation asks', 'flowchart TD\n    Start --> End\n    End --> Class\n    Style --> Click', ['Start', 'End', 'Class', 'Style', 'Click'], ['Start --> End', 'End --> Class', 'Style --> Click']],
  ['special characters inside quotes', 'flowchart LR\n    id1["This is the (text) in the box"]', ['This is the (text) in the box']],
  ['entity codes', 'flowchart LR\n    A["A double quote:#quot;"] --> B["A dec char:#9829;"]', ['A double quote:"', 'A dec char:♥'], ['A --> B']],
  ['subgraphs, a box named first outside moving into the one that names it again', 'flowchart TB\n    c1-->a2\n    subgraph one\n    a1-->a2\n    end\n    subgraph two\n    b1-->b2\n    end\n    subgraph three\n    c1-->c2\n    end', ['c1', 'a2', 'a1', 'b1', 'b2', 'c2'], ['c1 --> a2', 'a1 --> a2', 'b1 --> b2', 'c1 --> c2'], ['one: a2 a1', 'two: b1 b2', 'three: c1 c2']],
  ['a subgraph with an id and a title', 'flowchart TB\n    subgraph ide1 [one]\n    a1-->a2\n    end', ['a1', 'a2'], ['a1 --> a2'], ['one: a1 a2']],
  ['a quoted subgraph title', 'flowchart TB\n    subgraph "One title"\n    a1\n    end', ['a1'], [], ['One title: a1']],
  ['edges to and from subgraphs', 'flowchart TB\n    subgraph one\n    a1-->a2\n    end\n    subgraph two\n    b1-->b2\n    end\n    one --> two\n    two --> a1', ['a1', 'a2', 'b1', 'b2'], ['a1 --> a2', 'b1 --> b2', 'one --> two', 'two --> a1'], ['one: a1 a2', 'two: b1 b2']],
  ['direction in nested subgraphs', 'flowchart LR\n  subgraph TOP\n    direction TB\n    subgraph B1\n        direction RL\n        i1 -->f1\n    end\n    subgraph B2\n        direction BT\n        i2 -->f2\n    end\n  end\n  A --> TOP --> B\n  B1 --> B2', ['i1', 'f1', 'i2', 'f2', 'A', 'B'], ['i1 --> f1', 'i2 --> f2', 'A --> TOP', 'TOP --> B', 'B1 --> B2'], ['TOP: ', 'TOP/B1: i1 f1', 'TOP/B2: i2 f2']],
  ['a subgraph\'s settings', 'flowchart TD\n    Start --> one\n    subgraph one [My Group]\n        A --> B\n    end\n    one --> Stop\n    one@{ view: collapsed }', ['Start', 'A', 'B', 'Stop'], ['Start --> one', 'A --> B', 'one --> Stop'], ['My Group: A B']],
  ['markdown strings in boxes, edge labels and subgraph titles', 'flowchart LR\nsubgraph "One"\n  a("`The **cat**\n  in the hat`") -- "edge label" --> b{{"`The **dog** in the hog`"}}\nend\nsubgraph "`**Two**`"\n  c("`The **cat**\n  in the hat`") -- "`Bold **edge label**`" --> d("The dog in the hog")\nend', ['The cat\nin the hat', 'The dog in the hog', 'The cat\nin the hat', 'The dog in the hog'], ['a --> b |edge label|', 'c --> d |Bold edge label|'], ['One: a b', 'Two: c d']],
  ['click, in every form', 'flowchart LR\n    A-->B\n    B-->C\n    C-->D\n    click A callback "Tooltip for a callback"\n    click B "https://www.github.com" "This is a tooltip for a link"\n    click C call callback() "Tooltip for a callback"\n    click D href "https://www.github.com" "Open this in a new tab" _blank', ['A', 'B', 'C', 'D'], ['A --> B', 'B --> C', 'C --> D']],
  ['comments, on a line of their own', 'flowchart LR\n%% this is a comment A -- text --> B{node}\n   A -- text --> B -- text2 --> C', ['A', 'B', 'C'], ['A --> B |text|', 'B --> C |text2|']],
  ['style and linkStyle', 'flowchart LR\n    id1(Start)-->id2(Stop)\n    style id1 fill:#f9f,stroke:#333,stroke-width:4px\n    linkStyle 0 stroke:#ff3,stroke-width:4px,color:red;', ['Start', 'Stop'], ['id1 --> id2']],
  ['classDef, class and :::', 'flowchart LR\n    A:::foo & B:::bar --> C:::foobar\n    classDef foo stroke:#f00\n    class A,B foo', ['A', 'B', 'C'], ['A --> C', 'B --> C']],
  ['an accessible title and description, on one line and over several', 'flowchart LR\n    accTitle: A title; with a semicolon\n    accDescr: A description\n    accDescr {\n      over several\n      lines\n    }\n    A --> B', ['A', 'B'], ['A --> B']],
  ['spaces around links, no semicolons', 'flowchart LR\n    A[Hard edge] -->|Link text| B(Round edge)\n    B --> C{Decision}\n    C -->|One| D[Result one]', ['Hard edge', 'Round edge', 'Decision', 'Result one'], ['A --> B |Link text|', 'B --> C', 'C --> D |One|']],
]

const STATE: Form[] = [
  ['states and transitions, with a title in front matter', '---\ntitle: Simple sample\n---\nstateDiagram-v2\n    [*] --> Still\n    Still --> [*]\n    Still --> Moving\n    Crash --> [*]', ['●', 'Still', '●', 'Moving', 'Crash'], ['[*] --> Still', 'Still --> [*]', 'Still --> Moving', 'Crash --> [*]']],
  ['the first version\'s header', 'stateDiagram\n    [*] --> Still\n    Still --> [*]', ['●', 'Still', '●'], ['[*] --> Still', 'Still --> [*]']],
  ['a state named by its id', 'stateDiagram-v2\n    stateId', ['stateId']],
  ['a description with state … as', 'stateDiagram-v2\n    state "This is a state description" as s2', ['This is a state description']],
  ['a description after a colon', 'stateDiagram-v2\n    s2 : This is a state description', ['This is a state description']],
  ['a transition, with and without text', 'stateDiagram-v2\n    s1 --> s2\n    s2 --> s3: A transition', ['s1', 's2', 's3'], ['s1 --> s2', 's2 --> s3 |A transition|']],
  ['composite states, one named by a description', 'stateDiagram-v2\n    [*] --> First\n    state First {\n        [*] --> second\n        second --> [*]\n    }\n    [*] --> NamedComposite\n    NamedComposite: Another Composite\n    state NamedComposite {\n        [*] --> namedSimple\n        namedSimple --> [*]\n        namedSimple: Another simple\n    }', ['●', '●', 'second', '●', '●', 'Another simple', '●'], ['[*] --> First', '[*] --> second', 'second --> [*]', '[*] --> NamedComposite', '[*] --> namedSimple', 'namedSimple --> [*]'], ['First: [*] second [*]', 'Another Composite: [*] namedSimple [*]']],
  ['nested composite states', 'stateDiagram-v2\n    [*] --> First\n    state First {\n        [*] --> Second\n        state Second {\n            [*] --> second\n            second --> Third\n            state Third {\n                [*] --> third\n                third --> [*]\n            }\n        }\n    }', ['●', '●', '●', 'second', '●', 'third', '●'], ['[*] --> First', '[*] --> Second', '[*] --> second', 'second --> Third', '[*] --> third', 'third --> [*]'], ['First: [*]', 'First/Second: [*] second', 'First/Second/Third: [*] third [*]']],
  ['transitions between composite states', 'stateDiagram-v2\n    First --> Second\n    state First {\n        [*] --> fir\n    }\n    state Second {\n        sec --> [*]\n    }', ['●', 'fir', 'sec', '●'], ['First --> Second', '[*] --> fir', 'sec --> [*]'], ['First: [*] fir', 'Second: sec [*]']],
  ['a choice', 'stateDiagram-v2\n    state if_state <<choice>>\n    [*] --> IsPositive\n    IsPositive --> if_state\n    if_state --> False: if n < 0\n    if_state --> True : if n >= 0', ['if_state', '●', 'IsPositive', 'False', 'True'], ['[*] --> IsPositive', 'IsPositive --> if_state', 'if_state --> False |if n < 0|', 'if_state --> True |if n >= 0|']],
  ['a fork and a join', 'stateDiagram-v2\n    state fork_state <<fork>>\n    [*] --> fork_state\n    fork_state --> State2\n    state join_state <<join>>\n    State2 --> join_state\n    join_state --> [*]', ['fork_state', '●', 'State2', 'join_state', '●'], ['[*] --> fork_state', 'fork_state --> State2', 'State2 --> join_state', 'join_state --> [*]']],
  ['notes, on one line and on several, each a box of its own joined to its state by a dotted line', 'stateDiagram-v2\n    State1: The state with a note\n    note right of State1\n        Important information! You can write\n        notes.\n    end note\n    State1 --> State2\n    note left of State2 : This is the note to the left.', ['The state with a note', 'Important information! You can write\nnotes.', 'State2', 'This is the note to the left.'], ['State1 -.- note@1', 'State1 --> State2', 'State2 -.- note@3']],
  ['a label given to a composite state after it, which retitles its frame', 'stateDiagram-v2\n    state Outer {\n      A --> B\n    }\n    Outer: Renamed', ['A', 'B'], ['A --> B'], ['Renamed: A B']],
  ['concurrent regions, each with its own start', 'stateDiagram-v2\n    [*] --> Active\n    state Active {\n        [*] --> NumLockOff\n        NumLockOff --> NumLockOn : EvNumLockPressed\n        --\n        [*] --> CapsLockOff\n        CapsLockOff --> CapsLockOn : EvCapsLockPressed\n    }', ['●', '●', 'NumLockOff', 'NumLockOn', '●', 'CapsLockOff', 'CapsLockOn'], ['[*] --> Active', '[*] --> NumLockOff', 'NumLockOff --> NumLockOn |EvNumLockPressed|', '[*] --> CapsLockOff', 'CapsLockOff --> CapsLockOn |EvCapsLockPressed|'], ['Active: [*] NumLockOff NumLockOn [*] CapsLockOff CapsLockOn']],
  ['direction, at the top and in a composite state', 'stateDiagram\n    direction LR\n    [*] --> A\n    A --> B\n    state B {\n      direction LR\n      a --> b\n    }\n    B --> D', ['●', 'A', 'a', 'b', 'D'], ['[*] --> A', 'A --> B', 'a --> b', 'B --> D'], ['B: a b']],
  ['comments, on their own line and after a statement', 'stateDiagram-v2\n    [*] --> Still\n%% this is a comment\n    Still --> Moving %% another comment', ['●', 'Still', 'Moving'], ['[*] --> Still', 'Still --> Moving']],
  ['classDef, class, accTitle and accDescr', 'stateDiagram\n   direction TB\n   accTitle: This is the accessible title\n   accDescr: This is an accessible description\n   classDef movement font-style:italic\n   [*]--> Still\n   Still --> Moving\n   Moving --> Crash\n   class Still notMoving\n   class Moving, Crash movement\n   class end badBadEvent', ['●', 'Still', 'Moving', 'Crash'], ['[*] --> Still', 'Still --> Moving', 'Moving --> Crash']],
  ['an accessible description over several lines, beside a composite state', 'stateDiagram-v2\n    accDescr {\n      over several\n      lines\n    }\n    state Outer {\n      A --> B\n    }', ['A', 'B'], ['A --> B'], ['Outer: A B']],
  ['style, and keywords in any case', 'stateDiagram-v2\n    A --> B\n    style A fill:#f00\n    ACCTITLE: A title', ['A', 'B'], ['A --> B']],
  ['the ::: operator', 'stateDiagram\n   classDef notMoving fill:white\n   [*] --> Still:::notMoving\n   Still --> Moving:::movement\n   Crash:::badBadEvent --> [*]', ['●', 'Still', 'Moving', 'Crash', '●'], ['[*] --> Still', 'Still --> Moving', 'Crash --> [*]']],
  ['spaces in a state\'s name', 'stateDiagram\n    classDef yourState font-style:italic\n    yswsii: Your state with spaces in it\n    [*] --> yswsii:::yourState\n    yswsii --> YetAnotherState', ['Your state with spaces in it', '●', 'YetAnotherState'], ['[*] --> yswsii', 'yswsii --> YetAnotherState']],
]

for (const [name, source, boxes, edges = [], frames = []] of [...FLOWCHART, ...STATE]) {
  test(`${source.includes('stateDiagram') ? 'state diagram' : 'flowchart'}: ${name}`, () => {
    expect(read(source)).toEqual({ boxes, edges, frames, warnings: [] })
  })
}

// A label is the author's text. In every place a label sits, each character or operator that means
// something elsewhere must give the same boxes, edges and frames as a plain word, with the label whole.
const OPERATORS = [';', '-->', '---', '-.->', '==>', '&', '%%', '|', ':', '--', '[', ']', '(', ')', '{', '}']
const BRACKETS = ['[', ']', '(', ')', '{', '}', '|']

/**
 * Each place, with the operators Mermaid's own grammar reads as syntax there, and so are left out:
 * bare text in brackets or between pipes takes no bracket, pipe or quote; inline text ends at its own
 * kind of operator; in a state diagram, a `;` ends a description, a transition's label and a one-line
 * note, and a one-line note also ends at a `:`.
 */
const PLACES: [place: string, source: (label: string) => string, syntax: string[]][] = [
  ...(
    [
      ['[', ']'], ['(', ')'], ['([', '])'], ['[[', ']]'], ['[(', ')]'], ['((', '))'], ['>', ']'],
      ['{', '}'], ['{{', '}}'], ['[/', '/]'], ['[\\', '\\]'], ['(((', ')))'],
    ] as const
  ).map(([open, close]): (typeof PLACES)[number] => [`a box label in ${open}${close}`, l => `flowchart TD\n  A${open}${l}${close} --> B`, BRACKETS]),
  ['a quoted box label', l => `flowchart TD\n  A["${l}"] --> B`, []],
  ['shape data', l => `flowchart TD\n  A@{ shape: rect, label: "${l}" } --> B`, []],
  ['a link label between pipes', l => `flowchart TD\n  A -->|${l}| B`, BRACKETS],
  ['a quoted link label between pipes', l => `flowchart TD\n  A -->|"${l}"| B`, []],
  ['inline link text', l => `flowchart TD\n  A -- ${l} --> B`, ['-->', '---', '--']],
  ['inline dotted link text', l => `flowchart TD\n  A -. ${l} .-> B`, ['-.->']],
  ['inline thick link text', l => `flowchart TD\n  A == ${l} ==> B`, ['==>']],
  ['a subgraph title in brackets', l => `flowchart TD\n  subgraph S[${l}]\n    A --> B\n  end`, BRACKETS],
  ['a quoted subgraph title', l => `flowchart TD\n  subgraph "${l}"\n    A --> B\n  end`, []],
  ['a state description', l => `stateDiagram-v2\n  A : ${l}\n  A --> B`, [';']],
  ['state … as', l => `stateDiagram-v2\n  state "${l}" as A\n  A --> B`, []],
  ['a transition label', l => `stateDiagram-v2\n  A --> B : ${l}`, [';']],
  ['a one-line note', l => `stateDiagram-v2\n  A --> B\n  note right of A : ${l}`, [';', ':']],
  ['a note over several lines', l => `stateDiagram-v2\n  A --> B\n  note left of A\n    ${l}\n  end note`, []],
]

for (const [place, source, syntax] of PLACES) {
  test(`every operator inside ${place} is text, save where Mermaid reads it as syntax`, () => {
    const plain = JSON.stringify(read(source('a plain b')))
    const wrong = OPERATORS.filter(op => !syntax.includes(op)).flatMap(op => {
      const label = `a ${op} b`
      const want = plain.replaceAll('a plain b', JSON.stringify(label).slice(1, -1))
      const got = JSON.stringify(read(source(label)))
      return got === want ? [] : [`${op}: ${got}`]
    })
    expect(wrong).toEqual([])
  })
}

test('where Mermaid reads a ; in a state label as the end of the statement, so does the parser', () => {
  expect(read('stateDiagram-v2\n  A --> B : a ; b')).toEqual({ boxes: ['A', 'B', 'b'], edges: ['A --> B |a|'], frames: [], warnings: [] })
})

test('the two cases the review found draw whole', () => {
  expect(read('flowchart TD\n  A[foo;bar] --> B\n  C[#quot;] --> D')).toEqual({ boxes: ['foo;bar', 'B', '"', 'D'], edges: ['A --> B', 'C --> D'], frames: [], warnings: [] })
  expect(read('stateDiagram-v2\n  A --> B: sends --> signal')).toEqual({ boxes: ['A', 'B'], edges: ['A --> B |sends --> signal|'], frames: [], warnings: [] })
})
