import { describe, expect, test } from 'claude-code/testing'

import { grow } from './stretch/grow'
import { layout, link, linkAt, tint, widthOf } from './stretch/layout'
import { closeAfter, hideLongForms, newStreamState, paragraphsOf, parse, stretches } from './stretch/parse'

// Fixes ported from upstream cc-stretch 0.3.3 to 0.5.1, each with its upstream test.

const rows = (text: string, width: number) => layout(text, width).map(row => row.map(run => run.text).join(''))
const STEPS = 40
const frames = (short: string, long: string) => Array.from({ length: STEPS + 1 }, (_, i) => grow(short, [long], i / STEPS, () => ''))
/** Each `a b` in a frame whose space the long form does not have beside `a` or `b`. */
const addedSpaces = (shown: string[], long: string) =>
  shown.flatMap(frame => [...frame.matchAll(/(\S) (?=(\S))/gu)].filter(([, a, b]) => !long.includes(`${a} `) && !long.includes(` ${b}`)))

describe('parse', () => {
  test('keys a short form over several lines with ↵ for each line break, so no one-line short form shares its key', async () => {
    expect(stretches(parse('{{a\nb|1}} {{a b|2}} {{a|{{b|3}}}} {{a\n› b|4}}')).map(s => s.key)).toEqual(['a↵b', 'a b', 'a', 'a › b', 'a↵› b'])
  })

  test('lays out a stretch nested in a short form over two lines, whose key breaks no line', async () => {
    const text = 'Before {{the first line\nand the second|the long {{form|form drawn}} open}} after.'
    expect(stretches(parse(text)).map(s => s.key).filter(key => key.includes('\n'))).toEqual([])
  })
})

describe('streaming', () => {
  test('a code span over several lines is copied as written, and a stretch after it shows short', async () => {
    const state = newStreamState()
    expect(hideLongForms('Use `the', state)).toBe('Use `the')
    expect(hideLongForms('value` then {{tip|a tip}}.', state)).toBe('value` then tip.')
    expect(hideLongForms('Use `the\n{{a|b}} value` ok.', newStreamState())).toBe('Use `the\n{{a|b}} value` ok.')
  })

  test('a line starting with a fence marker and more text does not close the block, so braces after it stay as written', async () => {
    expect(hideLongForms(['```', '```python', '{{a|b}}', '```', '{{c|d}}'].join('\n'), newStreamState())).toBe(['```', '```python', '{{a|b}}', '```', 'c'].join('\n'))
  })
})

describe('layout', () => {
  // Nerd Font icons sit in the Private Use Area, so a reply can hold any of its characters.
  test('draws Private Use Area characters as written and keeps a link after them pressable', async () => {
    const icons = ' '
    const drawn = layout(`${icons}${link('open', 'k', 'four')} ok`, 30)
    expect(drawn.map(row => row.map(run => run.text).join(''))).toEqual([`${icons}four ok`])
    expect(linkAt(drawn, widthOf(icons) + 1, 0)).toEqual({ action: 'open', key: 'k' })
  })

  test('lays out a line holding a mark with no separator after it, reading the mark as a character', async () => {
    const start = link('open', 'k', 'x').charAt(0)
    const shade = tint('red', 'x').charAt(0)
    expect(rows(`a ${start} b ${shade} c`, 30)).toEqual([`a ${start} b ${shade} c`])
  })

  test('a closer after a code fence goes on a line of its own, however far the fence is indented', async () => {
    for (const indent of ['', '   ', '    ', '\t']) {
      const drawn = layout(closeAfter(`text\n${indent}\`\`\`\ncode\n${indent}\`\`\``, link('close', 'k', '«'), '\n'), 40)
      expect(linkAt(drawn, 0, drawn.length - 1)).toEqual({ action: 'close', key: 'k' })
      expect(drawn.at(-1)?.some(run => run.code === true)).toBe(false)
    }
  })

  test('counts an emoji as two cells and a flag as two in all, so a press after them lands on the right phrase', async () => {
    expect(widthOf('🚀🚗')).toBe(4)
    expect(widthOf('🇯🇵')).toBe(2)
    const drawn = layout(`a 🚀 ${link('open', 'k', 'open')} end`, 60)
    expect(linkAt(drawn, 8, 0)).toEqual({ action: 'open', key: 'k' })
    expect(linkAt(drawn, 4, 0)).toBeUndefined()
  })

  test('a line starting with a fence marker and more text does not close the block, and the lines after it are drawn as code', async () => {
    const text = ['```', '```python is a content line', 'still code', '```', 'after'].join('\n')
    expect(layout(text, 40).map(row => row.map(run => [run.text, run.code === true]))).toEqual([
      [['  ```python is a content line', true]],
      [['  still code', true]],
      [['after', false]],
    ])
  })
})

describe('paragraphs', () => {
  test('a code span over several lines ends at its closing backtick, so a stretch after it keeps its blank line inside', async () => {
    const text = ['Use `foo', 'bar` and {{a|long', '', 'form}}.'].join('\n')
    expect(paragraphsOf(text)).toEqual([{ text, hasStretch: true }])
  })

  test('a line starting with a fence marker and more text does not close the block', async () => {
    const text = ['```', '```python', '', '{{a|b}}', '```', 'After.'].join('\n')
    expect(paragraphsOf(text)).toEqual([{ text, hasStretch: false }])
  })
})

describe('Chinese', () => {
  test('fills a row before breaking between characters', async () => {
    expect(rows('ab 一二三四五', 10)).toEqual(['ab 一二三', '四五'])
  })

  test('keeps closing punctuation off the start of a row', async () => {
    expect(rows('一二三四五，六', 10)).toEqual(['一二三四', '五，六'])
  })

  test('keeps opening punctuation off the end of a row', async () => {
    expect(rows('一二三四「五六」', 10)).toEqual(['一二三四', '「五六」'])
  })

  test('breaks beside a Latin word, never inside it', async () => {
    expect(rows('写给我的Claude看', 10)).toEqual(['写给我的', 'Claude看'])
  })

  test('grows its long form around its short form over many frames, with no space the long form lacks', async () => {
    const long = '《道德经》的核心是道，也就是万物运行的根本规律，与人顺着道去做事的无为。'
    const shown = frames('核心是道，与无为。', long)
    expect(shown[0]).toBe('核心是道，与无为。')
    expect(shown.at(-1)).toBe(long)
    expect(new Set(shown).size).toBeGreaterThan(10)
    expect(addedSpaces(shown, long)).toEqual([])
    const mixed = '核心是道，也就是万物运行的 root rule 根本规律，与人顺着道去做事的无为。'
    expect(addedSpaces(frames('核心是道，与无为。', mixed), mixed)).toEqual([])
  })

  test('keeps ASCII punctuation and brackets with the characters they belong to', async () => {
    expect(rows('你好你好你,world', 10)).toEqual(['你好你好', '你,world'])
    expect(rows('一二三(四)Claude', 10)).toEqual(['一二三(四)', 'Claude'])
  })
})

describe('Japanese', () => {
  test('keeps a small kana and the long-vowel mark off the start of a row', async () => {
    expect(rows('あいうえおっと', 10)).toEqual(['あいうえ', 'おっと'])
    expect(rows('あいうえコーヒー', 10)).toEqual(['あいうえ', 'コーヒー'])
  })

  test('a combining voiced mark takes no cell and never starts a row', async () => {
    expect(widthOf('が')).toBe(2)
    expect(rows('一二三四が', 10)).toEqual(['一二三四が'])
    expect(rows('一二三四がa', 10)).toEqual(['一二三四', 'がa'])
  })
})

describe('Korean', () => {
  test('breaks at spaces and keeps each word whole', async () => {
    expect(rows('가나다 라마바사', 10)).toEqual(['가나다', '라마바사'])
  })
})

describe('Thai', () => {
  test('vowel and tone marks take no cell', async () => {
    expect(widthOf('สวัสดี')).toBe(4)
    expect(rows('สวัสดีครับ ผม', 10)).toEqual(['สวัสดีครับ ผม'])
  })

  test('breaks between words, which Thai writes without spaces', async () => {
    expect(rows('สวัสดีครับผมชื่อสมชาย', 10)).toEqual(['สวัสดีครับผม', 'ชื่อสมชาย'])
  })

  test('grows its long form around its short form over many frames', async () => {
    const long = 'แนวคิดหลักของคัมภีร์นี้คือการใช้ชีวิตตามเต๋า'
    const shown = frames('แนวคิดหลักคือเต๋า', long)
    expect(shown[0]).toBe('แนวคิดหลักคือเต๋า')
    expect(shown.at(-1)).toBe(long)
    expect(new Set(shown).size).toBeGreaterThan(4)
    expect(addedSpaces(shown, long)).toEqual([])
  })
})
