"use client";

import { useRef, useState } from "react";
import type { LibLocation, LibMap } from "@/lib/types";

type Props = {
  map: LibMap;
  locations: LibLocation[];
  /** 이 구역을 강조해서 보여줍니다(책을 찾을 때 / 반납 자리를 안내할 때). */
  highlightId?: string | null;
  /** 구역별 책 종수 - 배치도 안에 작게 표시합니다. */
  counts?: Record<string, number>;
  onPick?: (location: LibLocation) => void;
  /** 편집 모드 - 끌어서 자리를 옮길 수 있습니다. */
  editable?: boolean;
  onMove?: (id: string, x: number, y: number) => void;
  className?: string;
};

/**
 * 도서관 책장 배치도.
 *
 * 격자(예: 24 × 14칸) 위에 구역을 네모로 그립니다. 좌표는 구역마다 저장되어 있고, 아직 자리를
 * 정하지 않은 구역은 그리지 않습니다(구역 관리 화면에서 끌어다 놓으면 자리가 정해집니다).
 * SVG라서 화면을 키워도 글자와 선이 또렷합니다.
 */
export default function ShelfMap({
  map,
  locations,
  highlightId,
  counts,
  onPick,
  editable,
  onMove,
  className,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [ghost, setGhost] = useState<{ id: string; x: number; y: number } | null>(null);

  const placed = locations.filter((l) => l.map_x !== null && l.map_y !== null);

  /** 화면 좌표를 격자 좌표로 바꿉니다. */
  function toGrid(clientX: number, clientY: number) {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * map.cols,
      y: ((clientY - rect.top) / rect.height) * map.rows,
    };
  }

  function onPointerDown(e: React.PointerEvent, loc: LibLocation) {
    if (!editable) {
      onPick?.(loc);
      return;
    }
    const p = toGrid(e.clientX, e.clientY);
    setDragging({ id: loc.id, dx: p.x - (loc.map_x ?? 0), dy: p.y - (loc.map_y ?? 0) });
    setGhost({ id: loc.id, x: loc.map_x ?? 0, y: loc.map_y ?? 0 });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging) return;
    const loc = locations.find((l) => l.id === dragging.id);
    if (!loc) return;
    const p = toGrid(e.clientX, e.clientY);
    // 0.5칸 단위로 딱딱 붙게 하고, 배치도 밖으로 나가지 않게 막습니다.
    const snap = (v: number) => Math.round(v * 2) / 2;
    const x = Math.min(Math.max(0, snap(p.x - dragging.dx)), map.cols - loc.map_w);
    const y = Math.min(Math.max(0, snap(p.y - dragging.dy)), map.rows - loc.map_h);
    setGhost({ id: loc.id, x, y });
  }

  function onPointerUp() {
    if (dragging && ghost) onMove?.(dragging.id, ghost.x, ghost.y);
    setDragging(null);
    setGhost(null);
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${map.cols} ${map.rows}`}
      className={className ?? "w-full"}
      style={{ touchAction: "none" }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      {/* 바닥 */}
      <rect x={0} y={0} width={map.cols} height={map.rows} rx={0.4} fill="#f8fafc" stroke="#e2e8f0" strokeWidth={0.06} />

      {/* 격자 */}
      <g stroke="#e2e8f0" strokeWidth={0.03}>
        {Array.from({ length: map.cols - 1 }, (_, i) => (
          <line key={`v${i}`} x1={i + 1} y1={0} x2={i + 1} y2={map.rows} />
        ))}
        {Array.from({ length: map.rows - 1 }, (_, i) => (
          <line key={`h${i}`} x1={0} y1={i + 1} x2={map.cols} y2={i + 1} />
        ))}
      </g>

      {placed.map((loc) => {
        const isGhost = ghost?.id === loc.id;
        const x = isGhost ? ghost.x : (loc.map_x as number);
        const y = isGhost ? ghost.y : (loc.map_y as number);
        const active = highlightId === loc.id;
        const count = counts?.[loc.id];
        const labelSize = Math.min(loc.map_h * 0.42, loc.map_w * 0.36, 0.95);

        return (
          <g
            key={loc.id}
            onPointerDown={(e) => onPointerDown(e, loc)}
            style={{ cursor: editable ? "grab" : onPick ? "pointer" : "default" }}
          >
            <rect
              x={x}
              y={y}
              width={loc.map_w}
              height={loc.map_h}
              rx={0.25}
              fill={active ? loc.color : `${loc.color}1f`}
              stroke={loc.color}
              strokeWidth={active ? 0.16 : 0.07}
            />
            {active && (
              <rect
                x={x - 0.22}
                y={y - 0.22}
                width={loc.map_w + 0.44}
                height={loc.map_h + 0.44}
                rx={0.4}
                fill="none"
                stroke={loc.color}
                strokeWidth={0.09}
                strokeDasharray="0.5 0.35"
              >
                <animate attributeName="opacity" values="1;0.25;1" dur="1.4s" repeatCount="indefinite" />
              </rect>
            )}
            <text
              x={x + loc.map_w / 2}
              y={y + loc.map_h / 2 + labelSize * 0.35}
              textAnchor="middle"
              fontSize={labelSize}
              fontWeight={800}
              fill={active ? "#fff" : loc.color}
            >
              {loc.code}
            </text>
            {count !== undefined && loc.map_h >= 1.4 && (
              <text
                x={x + loc.map_w / 2}
                y={y + loc.map_h - 0.28}
                textAnchor="middle"
                fontSize={0.42}
                fill={active ? "#ffffffcc" : "#64748b"}
              >
                {count}종
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
