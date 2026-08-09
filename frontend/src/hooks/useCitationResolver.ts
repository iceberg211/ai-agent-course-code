import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import type { Citation } from '@/types'

const namesByPersona = new Map<string, Map<string, string>>()
const loadingByPersona = new Map<string, Promise<Map<string, string>>>()

function getKnowledgeBaseId(citation: Citation): string {
  const raw = citation.knowledgeBaseId ?? citation.knowledge_base_id
  return typeof raw === 'string' ? raw : ''
}

export function useCitationResolver() {
  const knowledgeBase = useKnowledgeBase()

  function hasMissingKnowledgeBaseName(citation: Citation): boolean {
    return !!getKnowledgeBaseId(citation) && !citation.knowledgeBaseName
  }

  function applyCached(personaId: string, citations: Citation[]): Citation[] {
    const names = namesByPersona.get(personaId) ?? new Map<string, string>()
    return citations.map((citation) => {
      if (citation.knowledgeBaseName) return citation
      const kbId = getKnowledgeBaseId(citation)
      const name = kbId ? names.get(kbId) : undefined
      return name ? { ...citation, knowledgeBaseName: name } : citation
    })
  }

  async function loadNames(personaId: string): Promise<Map<string, string>> {
    if (!personaId) return new Map()
    const cached = namesByPersona.get(personaId)
    if (cached) return cached

    const loading = loadingByPersona.get(personaId)
    if (loading) return loading

    const request = knowledgeBase.listKbsForPersona(personaId)
      .then((kbs) => {
        const names = new Map(kbs.map((kb) => [kb.id, kb.name]))
        namesByPersona.set(personaId, names)
        return names
      })
      .finally(() => {
        loadingByPersona.delete(personaId)
      })

    loadingByPersona.set(personaId, request)
    return request
  }

  async function resolve(
    personaId: string,
    citations: Citation[],
  ): Promise<Citation[]> {
    if (!citations.some(hasMissingKnowledgeBaseName)) {
      return citations
    }
    await loadNames(personaId)
    return applyCached(personaId, citations)
  }

  return {
    applyCached,
    hasMissingKnowledgeBaseName,
    resolve,
  }
}
