import { useAtom } from 'jotai'
import { selectedArtifactIdAtom } from '@/shared/store/task-center.atoms'

export function useSelectedArtifact() {
  const [selectedArtifactId, setSelectedArtifactId] = useAtom(selectedArtifactIdAtom)

  return {
    selectedArtifactId,
    setSelectedArtifactId,
  }
}
