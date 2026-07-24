import type { CitationStyle, Source } from '@shared/types'
import * as apa from './formatters/apa'
import * as chicago from './formatters/chicago'
import * as mla from './formatters/mla'

const FORMATTERS: Record<CitationStyle, (source: Source) => string> = {
  APA: apa.format,
  MLA: mla.format,
  Chicago: chicago.format
}

export function formatCitation(source: Source, style: CitationStyle): string {
  return FORMATTERS[style](source)
}
