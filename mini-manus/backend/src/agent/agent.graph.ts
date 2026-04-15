import {
  StateGraph,
  START,
  END,
  MemorySaver,
  InMemoryStore,
} from '@langchain/langgraph';
import { AgentStateAnnotation } from '@/agent/agent.state';
import { plannerNode } from '@/agent/nodes/planner.node';
import { executorNode } from '@/agent/nodes/executor.node';
import { checkerNode } from '@/agent/nodes/checker.node';
import { finalizerNode } from '@/agent/nodes/finalizer.node';

/**
 * Build and compile the agent graph. Called once at service initialization.
 *
 * Topology:
 *   START -> planner --> executor -> checker --> executor (continue/retry)
 *              |                            --> planner  (replan)
 *              |                            --> finalizer -> END (complete)
 *              +-> END (error)              --> END (fail/cancelled)
 */
export function buildAgentGraph() {
  return new StateGraph(AgentStateAnnotation)
    .addNode('planner', plannerNode, { ends: ['executor', END] })
    .addNode('executor', executorNode)
    .addNode('checker', checkerNode, {
      ends: ['executor', 'planner', 'finalizer', END],
    })
    .addNode('finalizer', finalizerNode)
    .addEdge(START, 'planner')
    .addEdge('executor', 'checker')
    .addEdge('finalizer', END);
}

export function compileAgentGraph() {
  return buildAgentGraph().compile({
    checkpointer: new MemorySaver(),
    store: new InMemoryStore(),
  });
}

export type CompiledAgentGraph = ReturnType<typeof compileAgentGraph>;
