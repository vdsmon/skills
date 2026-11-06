import { cells, width } from './text'

export const MAC_TABLE_COPY = `
ObjC.import('AppKit')
var input = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile
var payload = JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(input, $.NSUTF8StringEncoding)))
var item = $.NSPasteboardItem.alloc.init
if (!item.setStringForType(payload.html, $.NSPasteboardTypeHTML) ||
    !item.setStringForType(payload.text, $.NSPasteboardTypeString)) throw new Error('Cannot encode table')
var pasteboard = $.NSPasteboard.generalPasteboard
if (!pasteboard || !pasteboard.writeObjects) throw new Error('macOS clipboard is unavailable to this session')
pasteboard.clearContents
if (!pasteboard.writeObjects($.NSArray.arrayWithObject(item))) throw new Error('Cannot write clipboard')
if (ObjC.unwrap(pasteboard.stringForType($.NSPasteboardTypeHTML)) !== payload.html ||
    ObjC.unwrap(pasteboard.stringForType($.NSPasteboardTypeString)) !== payload.text) throw new Error('Clipboard verification failed')
`

export type ClipboardBackend = 'macos'

export type HelperCommand = { stdin: string; argv: string[]; failure: string }

export const clipboardCommand = (html: string, text: string): HelperCommand => ({
  stdin: JSON.stringify({ html, text }),
  argv: ['/usr/bin/osascript', '-l', 'JavaScript', '-e', MAC_TABLE_COPY],
  failure: 'macOS clipboard helper failed',
})

// Draws a table or diagram as a PNG on the clipboard: Menlo at 2x, each glyph at its own column, box and
// block glyphs scaled to fill their cell so rules and bars meet. Click-only, like the html copy.
export const MAC_IMAGE_COPY = `
ObjC.import('AppKit')
var input = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile
var payload = JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(input, $.NSUTF8StringEncoding)))
var rgb = function (c) { return $.NSColor.colorWithSRGBRedGreenBlueAlpha(c[0] / 255, c[1] / 255, c[2] / 255, 1) }
var font = $.NSFont.fontWithNameSize('Menlo', 14)
if (!font) font = $.NSFont.monospacedSystemFontOfSizeWeight(14, 0)
var faces = {}
var faceOf = function (g) {
  var key = (g.bold ? 'b' : '') + (g.italic ? 'i' : '')
  if (!faces[key]) {
    var face = font
    if (g.bold) face = $.NSFontManager.sharedFontManager.convertFontToHaveTrait(face, 2)
    if (g.italic) face = $.NSFontManager.sharedFontManager.convertFontToHaveTrait(face, 1)
    faces[key] = face
  }
  return faces[key]
}
var attributes = $.NSMutableDictionary.dictionary
attributes.setObjectForKey(font, $.NSFontAttributeName)
attributes.setObjectForKey(rgb(payload.foreground), $.NSForegroundColorAttributeName)
var pad = 16
var cell = Math.round($('M').sizeWithAttributes(attributes).width * 2) / 2
var line = Math.ceil(font.ascender - font.descender + font.leading)
var baseline = (line - font.ascender + font.descender) / 2 - font.descender
var block = $('█').boundingRectWithSizeOptionsAttributes($.NSMakeSize(1000, 1000), 8, attributes)
var width = 2 * pad + Math.ceil(cell * payload.columns)
var height = 2 * pad + line * payload.lines.length
var bitmap = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(null, width * 2, height * 2, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0)
if (!bitmap) throw new Error('Cannot draw image')
bitmap.size = $.NSMakeSize(width, height)
$.NSGraphicsContext.saveGraphicsState
$.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(bitmap))
rgb(payload.background).setFill
$.NSRectFill($.NSMakeRect(0, 0, width, height))
payload.lines.forEach(function (glyphs, i) {
  var bottom = height - pad - (i + 1) * line
  glyphs.forEach(function (g) {
    var x = pad + g.at * cell
    var painted = attributes
    if (g.color || g.bold || g.italic) {
      painted = attributes.mutableCopy
      if (g.color) painted.setObjectForKey(rgb(g.color), $.NSForegroundColorAttributeName)
      if (g.bold || g.italic) painted.setObjectForKey(faceOf(g), $.NSFontAttributeName)
    }
    if (!/^[─-▟]$/.test(g.text)) return $(g.text).drawWithRectOptionsAttributes($.NSMakeRect(x, bottom + baseline, 1000, 1000), 0, painted)
    $.NSGraphicsContext.saveGraphicsState
    $.NSRectClip($.NSMakeRect(x, bottom, cell, line))
    var fit = $.NSAffineTransform.transform
    fit.translateXByYBy(x, bottom)
    fit.scaleXByYBy(cell / block.size.width, line / block.size.height)
    fit.translateXByYBy(-block.origin.x, -block.origin.y)
    fit.concat
    $(g.text).drawWithRectOptionsAttributes($.NSMakeRect(0, 0, 1000, 1000), 0, painted)
    $.NSGraphicsContext.restoreGraphicsState
  })
})
$.NSGraphicsContext.restoreGraphicsState
var png = bitmap.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $.NSDictionary.dictionary)
var pasteboard = $.NSPasteboard.generalPasteboard
if (!png || !pasteboard) throw new Error('macOS clipboard is unavailable to this session')
pasteboard.clearContents
if (!pasteboard.setDataForType(png, $.NSPasteboardTypePNG)) throw new Error('Cannot write clipboard')
var back = pasteboard.dataForType($.NSPasteboardTypePNG)
if (!back || !back.isEqualToData(png)) throw new Error('Clipboard verification failed')
`

// A cell's ink: a hex color, or a color with bold and italic, as the screen draws it.
export type Ink = string | { color?: string; bold?: boolean; italic?: boolean } | undefined

type Face = { color?: number[]; bold?: true; italic?: true }

const rgbOf = (color: string | undefined, fallback: number[]): number[] =>
  color !== undefined && /^#[0-9a-f]{6}$/i.test(color) ? [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)) : fallback

const imageLines = (text: string, tint: (row: number, cell: number, glyph: string) => Face | undefined): ({ at: number; text: string } & Face)[][] =>
  text.split('\n').map((line, row) => cells(line).flatMap((g, at) => (g.trim() ? [{ at, text: g, ...tint(row, at, g) }] : [])))

const luma = ([r, g, b]: number[]): number => (0.299 * r! + 0.587 * g! + 0.114 * b!) / 255

// Text whose color matches the background is redrawn black or white; box and bar glyphs keep their color.
const readable = (foreground: number[], background: number[]): number[] =>
  Math.abs(luma(foreground) - luma(background)) >= 0.4 ? foreground : luma(background) > 0.5 ? [0, 0, 0] : [255, 255, 255]

const faceOf = (ink: Ink, background: number[], art: boolean): Face | undefined => {
  const look = typeof ink === 'object' ? ink : { color: ink }
  const rgb = rgbOf(look.color, [])
  const face: Face = { ...(rgb.length ? { color: art ? rgb : readable(rgb, background) } : {}), ...(look.bold ? { bold: true as const } : {}), ...(look.italic ? { italic: true as const } : {}) }
  return Object.keys(face).length ? face : undefined
}

export const imageCommand = (text: string, colors: { foreground?: string; background: string }, hues?: Ink[][]): HelperCommand => {
  const background = rgbOf(colors.background, [255, 255, 255])
  const lines = imageLines(text, (row, cell, glyph) => faceOf(hues?.[row]?.[cell], background, /^[─-╿·]$/.test(glyph)))
  const json = JSON.stringify({ lines, columns: Math.max(0, ...text.split('\n').map(width)), foreground: readable(rgbOf(colors.foreground, [0, 0, 0]), background), background })
  return { stdin: json, argv: ['/usr/bin/osascript', '-l', 'JavaScript', '-e', MAC_IMAGE_COPY], failure: 'macOS image helper failed' }
}
