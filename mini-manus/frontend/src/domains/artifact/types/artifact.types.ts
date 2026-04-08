import type { ArtifactType } from '@/shared/types/status'

export interface ArtifactDetail {
  id: string
  runId: string
  type: ArtifactType
  title: string
  content: string
  metadata: Record<string, unknown> | null
  createdAt: string
}
