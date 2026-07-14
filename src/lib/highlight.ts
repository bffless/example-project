/**
 * A deliberately tiny YAML tokenizer for the rule files shown on the demo pages.
 *
 * It is not a YAML parser and never needs to be: it colours comments, mapping
 * keys, and quoted scalars, and leaves everything else alone. Every token's
 * text is emitted verbatim, so concatenating a line's tokens always
 * reconstructs the original line — highlighting can never alter what a visitor
 * reads.
 */
export type TokenKind = 'comment' | 'key' | 'punct' | 'string' | 'plain'

export type Token = { text: string; kind: TokenKind }

/** `<indent><optional "- ">` then a plain (unquoted) key, then `:`. */
const KEY_LINE = /^(\s*(?:-\s+)?)([A-Za-z0-9_$@.\-[\]/*]+)(:)(.*)$/

const COMMENT_LINE = /^(\s*)(#.*)$/

function tokenizeValue(value: string): Token[] {
  if (value === '') return []
  // A quoted scalar, possibly preceded by the space after the colon.
  const quoted = /^(\s*)((["']).*\3)(\s*)$/.exec(value)
  if (quoted) {
    const tokens: Token[] = [
      { text: quoted[1], kind: 'plain' },
      { text: quoted[2], kind: 'string' },
    ]
    if (quoted[4]) tokens.push({ text: quoted[4], kind: 'plain' })
    return tokens
  }
  return [{ text: value, kind: 'plain' }]
}

/** Split one line of YAML into tokens. Lossless: the texts rejoin to `line`. */
export function tokenizeYamlLine(line: string): Token[] {
  const comment = COMMENT_LINE.exec(line)
  if (comment) {
    const tokens: Token[] = []
    if (comment[1]) tokens.push({ text: comment[1], kind: 'plain' })
    tokens.push({ text: comment[2], kind: 'comment' })
    return tokens
  }

  const key = KEY_LINE.exec(line)
  if (key) {
    const tokens: Token[] = []
    if (key[1]) tokens.push({ text: key[1], kind: 'plain' })
    tokens.push({ text: key[2], kind: 'key' })
    tokens.push({ text: key[3], kind: 'punct' })
    return tokens.concat(tokenizeValue(key[4]))
  }

  return line === '' ? [] : [{ text: line, kind: 'plain' }]
}

/** Tokenize a whole document, one token list per line. */
export function tokenizeYaml(source: string): Token[][] {
  return source.split('\n').map(tokenizeYamlLine)
}
