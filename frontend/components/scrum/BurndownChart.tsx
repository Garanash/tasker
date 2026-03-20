"use client";

type BurndownDatum = {
  date: string;
  remaining_points: number;
  remaining_cards: number;
  done_cards: number;
};

export function BurndownChart({ data }: { data: BurndownDatum[] }) {
  const width = 720;
  const height = 160;
  const padding = 16;

  const points = data ?? [];
  const maxVal = Math.max(1, ...points.map((p) => p.remaining_points));

  const toXY = (idx: number, val: number) => {
    const x =
      points.length <= 1
        ? padding
        : padding + (idx * (width - padding * 2)) / (points.length - 1);
    const y = padding + (1 - val / maxVal) * (height - padding * 2);
    return { x, y };
  };

  const path = points
    .map((p, i) => {
      const { x, y } = toXY(i, p.remaining_points);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  const last = points[points.length - 1];

  return (
    <div className="rounded-2xl border border-line bg-card p-4">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <div className="text-text1 text-sm">Burndown</div>
          <div className="text-text0 font-bold tracking-tight text-lg">
            {last ? `${last.remaining_points} очков осталось` : "Нет данных"}
          </div>
        </div>
        <div className="text-text1 text-sm">{points.length ? points[0].date : ""}</div>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-[160px] block"
          aria-label="Burndown chart"
        >
          <defs>
            <linearGradient id="burndownStroke" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#8A2BE2" stopOpacity="1" />
              <stop offset="100%" stopColor="#4B0082" stopOpacity="1" />
            </linearGradient>
          </defs>

          <path
            d={`M ${padding} ${height - padding} L ${width - padding} ${height - padding}`}
            stroke="rgb(42 42 42)"
            strokeWidth="1"
          />

          <path d={path} fill="none" stroke="url(#burndownStroke)" strokeWidth="3" />

          {points.map((p, i) => {
            const { x, y } = toXY(i, p.remaining_points);
            return (
              <g key={p.date + i}>
                <circle cx={x} cy={y} r="4.5" fill="rgb(17 17 17)" stroke="rgb(160 32 240)" strokeWidth="2" />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

