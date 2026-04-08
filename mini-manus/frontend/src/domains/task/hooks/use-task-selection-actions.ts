import { startTransition, useCallback } from 'react'
import { useSetAtom } from 'jotai'
import {
  isSidebarOpenAtom,
  selectedArtifactIdAtom,
  selectedRevisionIdAtom,
  selectedRunIdAtom,
  selectedTaskIdAtom,
} from '@/shared/store/task-center.atoms'

export function useTaskSelectionActions() {
  const setSelectedTaskId = useSetAtom(selectedTaskIdAtom)
  const setSelectedRevisionId = useSetAtom(selectedRevisionIdAtom)
  const setSelectedRunId = useSetAtom(selectedRunIdAtom)
  const setSelectedArtifactId = useSetAtom(selectedArtifactIdAtom)
  const setIsSidebarOpen = useSetAtom(isSidebarOpenAtom)

  const clearRunContext = useCallback(() => {
    setSelectedRunId(null)
    setSelectedArtifactId(null)
  }, [setSelectedArtifactId, setSelectedRunId])

  const selectTask = useCallback(
    (taskId: string) => {
      startTransition(() => {
        setSelectedTaskId(taskId)
        setSelectedRevisionId(null)
        clearRunContext()
        setIsSidebarOpen(false)
      })
    },
    [clearRunContext, setIsSidebarOpen, setSelectedRevisionId, setSelectedTaskId],
  )

  const selectRevision = useCallback(
    (revisionId: string) => {
      startTransition(() => {
        setSelectedRevisionId(revisionId)
        clearRunContext()
      })
    },
    [clearRunContext, setSelectedRevisionId],
  )

  const selectRun = useCallback(
    (runId: string) => {
      startTransition(() => {
        setSelectedRunId(runId)
        setSelectedArtifactId(null)
      })
    },
    [setSelectedArtifactId, setSelectedRunId],
  )

  const selectArtifact = useCallback(
    (artifactId: string) => {
      setSelectedArtifactId(artifactId)
    },
    [setSelectedArtifactId],
  )

  return {
    selectTask,
    selectRevision,
    selectRun,
    selectArtifact,
  }
}
