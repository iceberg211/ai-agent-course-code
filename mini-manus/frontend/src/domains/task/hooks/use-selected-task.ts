import { useAtom } from 'jotai'
import { selectedTaskIdAtom } from '@/shared/store/task-center.atoms'

export function useSelectedTask() {
  const [selectedTaskId, setSelectedTaskId] = useAtom(selectedTaskIdAtom)

  return {
    selectedTaskId,
    setSelectedTaskId,
  }
}
