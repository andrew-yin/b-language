import { Options } from 'acorn'
import * as es from 'estree'

import { Chapter, Language, Variant } from './types'

export const CUT = 'cut' // cut operator for Source 4.3
export const TRY_AGAIN = 'retry' // command for Source 4.3
export const GLOBAL = typeof window === 'undefined' ? global : window
export const NATIVE_STORAGE_ID = 'nativeStorage'
export const MODULE_PARAMS_ID = 'moduleParams'
export const MODULE_CONTEXTS_ID = 'moduleContexts'
export const MAX_LIST_DISPLAY_LENGTH = 100
export const UNKNOWN_LOCATION: es.SourceLocation = {
  start: {
    line: -1,
    column: -1
  },
  end: {
    line: -1,
    column: -1
  }
}
export const JSSLANG_PROPERTIES = {
  maxExecTime: 1000,
  factorToIncreaseBy: 10
}

export const sourceLanguages: Language[] = [{ chapter: Chapter.C, variant: Variant.DEFAULT }]

export const ACORN_PARSE_OPTIONS: Options = { ecmaVersion: 2015 }

/**
 * Memory
 */
export const WORD_SIZE = 8 // 8 bytes per word
export const MEMORY_SIZE = 2**20 * 8 // 8MB of memory
export const HEAP_SIZE = MEMORY_SIZE / 2 // arbitrarily set max total heap elements to 50% of total memory
export const HEADER_SIZE = 2*WORD_SIZE // 1 word for type, 1 word for size

// node -> size/type/data/
export const SIZE_OFFSET = 0 // offset of size field in header
export const TYPE_OFFSET = 1*WORD_SIZE // offset of type field in header
export const DATA_OFFSET = 2*WORD_SIZE // offset of data field in header


// we use first byte of header to store the type of the data
export const INT = 0
export const FLOAT = 1
export const CHAR = 2
export const ADDRESS = 3
export const LIST = 4
