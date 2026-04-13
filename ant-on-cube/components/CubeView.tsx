'use client';

import { EDGES, START_STATE, VERTICES, VertexId } from '@/lib/cube';

type CubeViewProps = {
  current: VertexId;
};

export function CubeView({ current }: CubeViewProps) {
  const byId = Object.fromEntries(VERTICES.map((vertex) => [vertex.id, vertex]));

  const start = byId[START_STATE.current];
  const ant = byId[current];

  return (
    <svg viewBox="0 0 360 320" aria-label="Cube wireframe with ant position">
      <rect x="0" y="0" width="360" height="320" fill="#0b1221" rx="16" />
      {EDGES.map(([a, b]) => (
        <line
          key={`${a}-${b}`}
          x1={byId[a].point2D[0]}
          y1={byId[a].point2D[1]}
          x2={byId[b].point2D[0]}
          y2={byId[b].point2D[1]}
          stroke="#87a3ff"
          strokeWidth="3"
          strokeLinecap="round"
        />
      ))}

      {VERTICES.map((vertex) => (
        <circle
          key={vertex.id}
          cx={vertex.point2D[0]}
          cy={vertex.point2D[1]}
          r="5"
          fill={vertex.id === current ? '#ffda70' : '#d0dcff'}
          stroke="#0b1221"
          strokeWidth="2"
        />
      ))}

      <line
        x1={start.point2D[0] - 28}
        y1={start.point2D[1] - 18}
        x2={start.point2D[0]}
        y2={start.point2D[1]}
        stroke="#70f0ff"
        strokeDasharray="4 4"
      />
      <text x={start.point2D[0] - 85} y={start.point2D[1] - 24} fill="#70f0ff" fontSize="12">
        Ant starts approaching here
      </text>

      <text x={ant.point2D[0] + 8} y={ant.point2D[1] - 10} fill="#ffda70" fontSize="16">
        🐜
      </text>
    </svg>
  );
}
