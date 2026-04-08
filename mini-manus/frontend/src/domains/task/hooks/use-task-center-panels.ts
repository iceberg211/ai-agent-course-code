import { useAtom } from 'jotai'
import {
  isEditModalOpenAtom,
  isSidebarOpenAtom,
} from '@/shared/store/task-center.atoms'

export function useTaskCenterPanels() {
  const [isSidebarOpen, setIsSidebarOpen] = useAtom(isSidebarOpenAtom)
  const [isEditModalOpen, setIsEditModalOpen] = useAtom(isEditModalOpenAtom)

  return {
    isSidebarOpen,
    openSidebar: () => setIsSidebarOpen(true),
    closeSidebar: () => setIsSidebarOpen(false),
    toggleSidebar: () => setIsSidebarOpen((value) => !value),
    isEditModalOpen,
    openEditModal: () => setIsEditModalOpen(true),
    closeEditModal: () => setIsEditModalOpen(false),
  }
}
