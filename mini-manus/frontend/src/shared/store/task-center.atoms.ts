import { atom } from 'jotai'

export const selectedTaskIdAtom = atom<string | null>(null)
export const selectedRevisionIdAtom = atom<string | null>(null)
export const selectedRunIdAtom = atom<string | null>(null)
export const selectedArtifactIdAtom = atom<string | null>(null)
export const isSidebarOpenAtom = atom(false)
export const isEditModalOpenAtom = atom(false)
