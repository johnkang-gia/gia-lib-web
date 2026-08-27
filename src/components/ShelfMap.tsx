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
  /**
   * 여러 개를 골랐을 때(요청: "드래그해서 복수선택해서 위치옮길 수 있게").
   * 고른 것들은 테두리가 굵어지고, 하나를 끌면 나머지도 같은 만큼 함께 움직입니다.
   */
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  /** 여러 개를 한꺼번에 옮겼을 때 - 각자의 새 자리를 한 번에 넘겨줍니다. */
  onMoveMany?: (moves: { id: string; x: number; y: number }[]) => void;
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
  selectedIds,
  onSelectionChange,
  onMoveMany,
  className,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [ghost, setGhost] = useState<{ id: string; x: number; y: number } | null>(null);
  /** 여러 개를 함께 끌 때 각자의 임시 자리. */
  const [groupGhost, setGroupGhost] = useState<Record<string, { x: number; y: number }> | null>(
    null
  );
  /** 빈 곳을 끌어 만드는 선택 사각형. */
  const [lasso, setLasso] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null
  );
  const selected = new Set(selectedIds ?? []);

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

    // Shift(또는 Ctrl/⌘)를 누른 채 누르면 골라 담기/빼기입니다.
    if (onSelectionChange && (e.shiftKey || e.metaKey || e.ctrlKey)) {
      const next = new Set(selected);
      if (next.has(loc.id)) next.delete(loc.id);
      else next.add(loc.id);
      onSelectionChange([...next]);
      return;
    }

    // 이미 고른 것 중 하나를 끌면 고른 것 전부가 함께 움직입니다.
    if (selected.has(loc.id) && selected.size > 1) {
      setDragging({ id: loc.id, dx: p.x - (loc.map_x ?? 0), dy: p.y - (loc.map_y ?? 0) });
      setGroupGhost(
        Object.fromEntries(
          locations
            .filter((l) => selected.has(l.id) && l.map_x !== null && l.map_y !== null)
            .map((l) => [l.id, { x: l.map_x as number, y: l.map_y as number }])
        )
      );
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }

    // 하나만 끌 때는 고른 목록도 그 하나로 바꿉니다(엑셀에서 셀 하나 누르는 것과 같습니다).
    if (onSelectionChange && !selected.has(loc.id)) onSelectionChange([loc.id]);
    setDragging({ id: loc.id, dx: p.x - (loc.map_x ?? 0), dy: p.y - (loc.map_y ?? 0) });
    setGhost({ id: loc.id, x: loc.map_x ?? 0, y: loc.map_y ?? 0 });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const p = toGrid(e.clientX, e.clientY);
    const snap = (v: number) => Math.round(v * 2) / 2;

    // 빈 곳에서 끄는 중이면 선택 사각형을 늘립니다.
    if (lasso) {
      setLasso({ ...lasso, x1: p.x, y1: p.y });
      return;
    }
    if (!dragging) return;
    const loc = locations.find((l) => l.id === dragging.id);
    if (!loc) return;

    // 여러 개를 함께 끄는 중 - 기준이 움직인 만큼 나머지도 같이 옮깁니다.
    if (groupGhost) {
      const baseX = Math.min(Math.max(0, snap(p.x - dragging.dx)), map.cols - loc.map_w);
      const baseY = Math.min(Math.max(0, snap(p.y - dragging.dy)), map.rows - loc.map_h);
      const shiftX = baseX - (loc.map_x as number);
      const shiftY = baseY - (loc.map_y as number);
      const next: Record<string, { x: number; y: number }> = {};
      for (const l of locations) {
        if (!selected.has(l.id) || l.map_x === null || l.map_y === null) continue;
        next[l.id] = {
          x: Math.min(Math.max(0, (l.map_x as number) + shiftX), map.cols - l.map_w),
          y: Math.min(Math.max(0, (l.map_y as number) + shiftY), map.rows - l.map_h),
        };
      }
      setGroupGhost(next);
      return;
    }

    // 0.5칸 단위로 딱딱 붙게 하고, 배치도 밖으로 나가지 않게 막습니다.
    const x = Math.min(Math.max(0, snap(p.x - dragging.dx)), map.cols - loc.map_w);
    const y = Math.min(Math.max(0, snap(p.y - dragging.dy)), map.rows - loc.map_h);
    setGhost({ id: loc.id, x, y });
  }

  function onPointerUp() {
    // 선택 사각형 마무리 - 사각형에 닿은 구역을 전부 고릅니다.
    if (lasso) {
      const left = Math.min(lasso.x0, lasso.x1);
      const right = Math.max(lasso.x0, lasso.x1);
      const top = Math.min(lasso.y0, lasso.y1);
      const bottom = Math.max(lasso.y0, lasso.y1);
      // 아주 작게 끌었으면(=그냥 클릭) 선택을 비웁니다.
      const tiny = right - left < 0.4 && bottom - top < 0.4;
      const hit = tiny
        ? []
        : placed
            .filter(
              (l) =>
                (l.map_x as number) < right &&
                (l.map_x as number) + l.map_w > left &&
                (l.map_y as number) < bottom &&
                (l.map_y as number) + l.map_h > top
            )
            .map((l) => l.id);
      onSelectionChange?.(hit);
      setLasso(null);
      return;
    }

    if (dragging && groupGhost) {
      onMoveMany?.(Object.entries(groupGhost).map(([id, pos]) => ({ id, ...pos })));
    } else if (dragging && ghost) {
      onMove?.(dragging.id, ghost.x, ghost.y);
    }
    setDragging(null);
    setGhost(null);
    setGroupGhost(null);
  }

  /** 빈 바닥을 누르면 선택 사각형을 시작합니다. */
  function onBackgroundDown(e: React.PointerEvent) {
    if (!editable || !onSelectionChange) return;
    const p = toGrid(e.clientX, e.clientY);
    setLasso({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
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
      <rect
        x={0}
        y={0}
        width={map.cols}
        height={map.rows}
        rx={0.4}
        fill="#f8fafc"
        stroke="#e2e8f0"
        strokeWidth={0.06}
        onPointerDown={onBackgroundDown}
        style={{ cursor: editable && onSelectionChange ? "crosshair" : "default" }}
      />

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
        const gg = groupGhost?.[loc.id];
        const x = gg ? gg.x : isGhost ? ghost.x : (loc.map_x as number);
        const y = gg ? gg.y : isGhost ? ghost.y : (loc.map_y as number);
        const active = highlightId === loc.id;
        const picked = selected.has(loc.id);
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
              fill={active ? loc.color : picked ? `${loc.color}3d` : `${loc.color}1f`}
              stroke={loc.color}
              strokeWidth={active ? 0.16 : picked ? 0.18 : 0.07}
            />
            {picked && !active && (
              <rect
                x={x - 0.18}
                y={y - 0.18}
                width={loc.map_w + 0.36}
                height={loc.map_h + 0.36}
                rx={0.4}
                fill="none"
                stroke="#0f172a"
                strokeWidth={0.07}
                strokeDasharray="0.4 0.3"
              />
            )}
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
      {/* 끌어서 만드는 선택 사각형 */}
      {lasso && (
        <rect
          x={Math.min(lasso.x0, lasso.x1)}
          y={Math.min(lasso.y0, lasso.y1)}
          width={Math.abs(lasso.x1 - lasso.x0)}
          height={Math.abs(lasso.y1 - lasso.y0)}
          fill="#0f172a14"
          stroke="#0f172a"
          strokeWidth={0.06}
          strokeDasharray="0.3 0.25"
          pointerEvents="none"
        />
      )}

    </svg>
  );
}
