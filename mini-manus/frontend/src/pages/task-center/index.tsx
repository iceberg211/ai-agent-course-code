import { useMemo } from "react";
import "@/pages/task-center/task-center.scss";
import { ArtifactSection } from "@/domains/artifact/components/artifact-section";
import { useArtifactSelectionSync } from "@/domains/artifact/hooks/use-artifact-selection-sync";
import { useSelectedArtifact } from "@/domains/artifact/hooks/use-selected-artifact";
import { PlanSection } from "@/domains/plan/components/plan-section";
import { RunDebugPanel } from "@/domains/run/components/run-debug-panel";
import { TimelineSection } from "@/domains/run/components/timeline-section";
import { useRunDetailQuery } from "@/domains/run/hooks/use-run-detail-query";
import { useSelectedRun } from "@/domains/run/hooks/use-selected-run";
import { TaskEditModal } from "@/domains/task/components/task-edit-modal";
import { TaskSidebar } from "@/domains/task/components/task-sidebar";
import { TaskSummaryPanel } from "@/domains/task/components/task-summary-panel";
import { useSelectedRevision } from "@/domains/task/hooks/use-selected-revision";
import { approveRun, rejectRun } from "@/core/api/task.api";
import { useTaskActions } from "@/domains/task/hooks/use-task-actions";
import { useTaskCenterPanels } from "@/domains/task/hooks/use-task-center-panels";
import { useTaskDetailQuery } from "@/domains/task/hooks/use-task-detail-query";
import { useTaskListQuery } from "@/domains/task/hooks/use-task-list-query";
import { useTaskSelectionActions } from "@/domains/task/hooks/use-task-selection-actions";
import { useTaskSelectionSync } from "@/domains/task/hooks/use-task-selection-sync";
import { useSelectedTask } from "@/domains/task/hooks/use-selected-task";
import { useTaskSocketSync } from "@/domains/task/hooks/use-task-socket-sync";
import { Button } from "@/shared/ui/button";
import { EmptyState } from "@/shared/ui/empty-state";
import { SkeletonLoader } from "@/shared/ui/skeleton-loader";
import { cn } from "@/shared/utils/cn";

export function TaskCenterPage() {
  const panels = useTaskCenterPanels();
  const selectionActions = useTaskSelectionActions();
  const taskActions = useTaskActions();
  const { selectedTaskId } = useSelectedTask();
  const { selectedRevisionId } = useSelectedRevision();
  const { selectedRunId } = useSelectedRun();
  const { selectedArtifactId } = useSelectedArtifact();
  const taskListQuery = useTaskListQuery();
  const taskDetailQuery = useTaskDetailQuery(selectedTaskId);

  useTaskSelectionSync(taskListQuery.data, taskDetailQuery.data);
  const { liveRunFeed, socketConnected } = useTaskSocketSync(
    selectedTaskId,
    selectedRunId,
  );

  const runDetailQuery = useRunDetailQuery(
    selectedTaskId,
    selectedRunId,
    taskDetailQuery.data?.currentRun ?? null,
  );

  useArtifactSelectionSync(runDetailQuery.runDetail?.artifacts);

  const selectedRevision = useMemo(
    () =>
      taskDetailQuery.data?.revisions.find(
        (revision) => revision.id === selectedRevisionId,
      ) ??
      taskDetailQuery.data?.revisions[0] ??
      null,
    [selectedRevisionId, taskDetailQuery.data?.revisions],
  );

  const revisionRuns = useMemo(() => {
    if (!taskDetailQuery.data || !selectedRevision) return [];

    return taskDetailQuery.data.runs
      .filter((run) => run.revisionId === selectedRevision.id)
      .sort((left, right) => right.runNumber - left.runNumber);
  }, [selectedRevision, taskDetailQuery.data]);

  const currentRun = runDetailQuery.runDetail;
  const hasTasks = (taskListQuery.data?.length ?? 0) > 0;
  const currentRevisionInput =
    taskDetailQuery.data?.revisions.find(
      (revision) => revision.id === taskDetailQuery.data.task.currentRevisionId,
    )?.input ?? "";

  return (
    <div className="task-center-shell">
      <div
        className={cn(
          "task-center-shell__scrim",
          panels.isSidebarOpen && "task-center-shell__scrim--visible",
        )}
        onClick={panels.closeSidebar}
      />

      <TaskSidebar
        isOpen={panels.isSidebarOpen}
        isCreating={taskActions.createTaskMutation.isPending}
        onClose={panels.closeSidebar}
        onCreateTask={(input, approvalMode) =>
          taskActions.createTaskMutation.mutateAsync({ input, approvalMode })
        }
        onSelectTask={(id) => {
          selectionActions.selectTask(id);
          panels.closeSidebar();
        }}
        onDeleteTask={(id) => taskActions.deleteTaskMutation.mutate(id)}
        selectedTaskId={selectedTaskId}
        tasks={taskListQuery.data ?? []}
      />

      <main className="task-center-main">
        {/* 顶部导航条：仅左侧按钮 */}
        <header className="task-center-topbar">
          <Button variant="ghost" onClick={panels.toggleSidebar}>
            ← 任务列表
          </Button>
        </header>

        {!hasTasks ? (
          <section className="task-center-empty">
            <EmptyState
              title="创建你的第一个任务"
              description="💡 用自然语言描述你想要完成的任务，系统将自动进行规划并执行落地。"
            />
          </section>
        ) : !taskDetailQuery.data ? (
          <section className="task-center-empty">
            <SkeletonLoader />
          </section>
        ) : (
          <div className="task-center-grid">
            {/* 任务头部 */}
            <TaskSummaryPanel
              isCancelling={taskActions.cancelTaskMutation.isPending}
              isRetrying={taskActions.retryTaskMutation.isPending}
              liveRunFeed={liveRunFeed}
              onCancel={() => {
                if (selectedTaskId)
                  taskActions.cancelTaskMutation.mutate(selectedTaskId);
              }}
              onOpenEdit={panels.openEditModal}
              onRetry={() => {
                if (selectedTaskId)
                  taskActions.retryTaskMutation.mutate(selectedTaskId);
              }}
              onSelectRevision={selectionActions.selectRevision}
              onSelectRun={selectionActions.selectRun}
              revisionInput={selectedRevision?.input ?? ""}
              revisions={taskDetailQuery.data.revisions}
              runs={revisionRuns}
              selectedRevisionId={selectedRevision?.id ?? null}
              selectedRunId={selectedRunId}
              socketConnected={socketConnected}
              task={taskDetailQuery.data.task}
            />

            {/* 产物区 — 有产物时优先展示 */}
            <ArtifactSection
              artifacts={currentRun?.artifacts ?? []}
              onSelectArtifact={selectionActions.selectArtifact}
              selectedArtifactId={selectedArtifactId}
            />

            {/* 执行过程 + 计划：并列 */}
            <section className="task-center-grid__columns">
              <TimelineSection
                taskId={selectedTaskId ?? ""}
                liveRunFeed={liveRunFeed}
                plans={currentRun?.plans ?? []}
                stepRuns={currentRun?.stepRuns ?? []}
                onApprove={approveRun}
                onReject={rejectRun}
              />
              <PlanSection
                liveRunFeed={liveRunFeed}
                plans={currentRun?.plans ?? []}
                stepRuns={currentRun?.stepRuns ?? []}
              />
            </section>

            {/* 执行指标 — 默认折叠，面向调试场景 */}
            <details className="task-metrics-disclosure">
              <summary>执行指标</summary>
              <RunDebugPanel
                liveRunFeed={liveRunFeed}
                runDetail={currentRun ?? null}
              />
            </details>
          </div>
        )}
      </main>

      <TaskEditModal
        initialValue={currentRevisionInput}
        isOpen={panels.isEditModalOpen}
        isPending={taskActions.editTaskMutation.isPending}
        onClose={panels.closeEditModal}
        onSubmit={(input) =>
          selectedTaskId
            ? taskActions.editTaskMutation.mutateAsync({
                input,
                taskId: selectedTaskId,
              })
            : Promise.resolve()
        }
      />
    </div>
  );
}
