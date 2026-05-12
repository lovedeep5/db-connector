"use client";
import { X } from "lucide-react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  type EdgeProps,
} from "@xyflow/react";

/**
 * Edge with a small trash button at its midpoint, visible when the edge is
 * hovered or selected. Clicking it removes the edge from the canvas.
 */
export function DeletableEdge(props: EdgeProps) {
  const { setEdges } = useReactFlow();
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
  });

  return (
    <>
      <BaseEdge id={props.id} path={edgePath} markerEnd={props.markerEnd} style={props.style} />
      <EdgeLabelRenderer>
        <button
          type="button"
          aria-label="Delete edge"
          onClick={(e) => {
            e.stopPropagation();
            setEdges((es) => es.filter((edge) => edge.id !== props.id));
          }}
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
          }}
          className={
            "nodrag nopan h-5 w-5 rounded-full border bg-background text-destructive shadow-sm " +
            "flex items-center justify-center opacity-0 hover:opacity-100 " +
            "[.react-flow__edge.selected_&]:opacity-100 [.react-flow__edge:hover_&]:opacity-100 " +
            "transition-opacity"
          }
        >
          <X className="h-3 w-3" />
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
