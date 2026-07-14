import { describe, it, expect } from 'vitest'
import { tokenizeYamlLine, tokenizeYaml, type Token } from './highlight'
import { ALL_SOURCE_FILES } from './ruleFiles'

const join = (tokens: Token[]) => tokens.map((t) => t.text).join('')
const kinds = (tokens: Token[]) => tokens.map((t) => `${t.kind}:${t.text}`)

describe('tokenizeYamlLine', () => {
  it('marks a whole-line comment', () => {
    expect(kinds(tokenizeYamlLine('  # a note'))).toEqual(['plain:  ', 'comment:# a note'])
  })

  it('marks a key and its colon', () => {
    expect(kinds(tokenizeYamlLine('name: form_handler'))).toEqual([
      'key:name',
      'punct::',
      'plain: form_handler',
    ])
  })

  it('marks a key inside a list item', () => {
    expect(kinds(tokenizeYamlLine('    - id: upload'))).toEqual([
      'plain:    - ',
      'key:id',
      'punct::',
      'plain: upload',
    ])
  })

  it('marks a quoted scalar as a string', () => {
    expect(kinds(tokenizeYamlLine('  body: "{{{steps.upload}}}"'))).toEqual([
      'plain:  ',
      'key:body',
      'punct::',
      'plain: ',
      'string:"{{{steps.upload}}}"',
    ])
  })

  it('leaves a bare list item alone', () => {
    expect(kinds(tokenizeYamlLine('    - image/*'))).toEqual(['plain:    - image/*'])
  })

  it('does not mistake a quoted JSON key inside a block scalar for a YAML key', () => {
    expect(kinds(tokenizeYamlLine('    "comments": {{{steps.list_comments}}}'))).toEqual([
      'plain:    "comments": {{{steps.list_comments}}}',
    ])
  })

  it('keeps a URL value intact', () => {
    const line = '        url: "\'https://raw.githubusercontent.com/bffless/ce/main/install.sh\'"'
    expect(join(tokenizeYamlLine(line))).toBe(line)
    expect(tokenizeYamlLine(line).find((t) => t.kind === 'key')?.text).toBe('url')
  })
})

describe('tokenizeYaml', () => {
  it('is lossless over every YAML file the site renders', () => {
    for (const file of ALL_SOURCE_FILES.filter((f) => f.lang === 'yaml')) {
      const rebuilt = tokenizeYaml(file.source)
        .map(join)
        .join('\n')
      expect(rebuilt, file.path).toBe(file.source)
    }
  })
})
