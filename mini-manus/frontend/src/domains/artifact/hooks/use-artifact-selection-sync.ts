import { useEffect } from 'react'
import type { ArtifactDetail } from '@/domains/artifact/types/artifact.types'
import { useSelectedArtifact } from '@/domains/artifact/hooks/use-selected-artifact'

export function useArtifactSelectionSync(artifacts: ArtifactDetail[] | undefined) {
  const { selectedArtifactId, setSelectedArtifactId } = useSelectedArtifact()

  useEffect(() => {
    if (!artifacts?.length) {
      if (selectedArtifactId) {
        setSelectedArtifactId(null)
      }
      return
    }

    const hasArtifact = selectedArtifactId
      ? artifacts.some((artifact) => artifact.id === selectedArtifactId)
      : false

    if (!hasArtifact) {
      setSelectedArtifactId(artifacts[0].id)
    }
  }, [artifacts, selectedArtifactId, setSelectedArtifactId])
}
