import { useAtom } from 'jotai'
import { selectedRevisionIdAtom } from '@/shared/store/task-center.atoms'

export function useSelectedRevision() {
  const [selectedRevisionId, setSelectedRevisionId] = useAtom(selectedRevisionIdAtom)

  return {
    selectedRevisionId,
    setSelectedRevisionId,
  }
}
