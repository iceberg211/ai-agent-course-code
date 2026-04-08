import { useAtom } from 'jotai'
import { selectedRunIdAtom } from '@/shared/store/task-center.atoms'

export function useSelectedRun() {
  const [selectedRunId, setSelectedRunId] = useAtom(selectedRunIdAtom)

  return {
    selectedRunId,
    setSelectedRunId,
  }
}
