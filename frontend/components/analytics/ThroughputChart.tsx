"use client";

type ThroughputPoint = { date: string; done_cards: number };

export function ThroughputChart({ data }: { data: ThroughputPoint[] }) {
  const width = 720;
  const height = 140;
  const pad = 16;

  const points = data ?? [];
  const maxVal = Math.max(1, ...points.map((p) => p.done_cards));

  const toXY = (idx: number, value: number) => {
    const x =
      points.length <= 1 ? pad : pad + (idx * (width - pad * 2)) / (points.length - 1);
    const y = pad + (1 - value / maxVal) * (height - pad * 2);
    return { x, y };
  };

  const path = points
    .map((p, i) => {
      const { x, y } = toXY(i, p.done_cards);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <div className="rounded-2xl border border-line bg-card p-4">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <div className="text-text1 text-sm">Throughput</div>
          <div className="text-text0 font-bold tracking-tight text-lg mt-1">
            {points.length ? points.reduce((a, b) => a + b.done_cards, 0) : 0} завершений
          </div>
        </div>
        <div className="text-text1 text-sm">
          {points.length ? points[0].date : ""}
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[140px] block" aria-label="Throughput chart">
          <defs>
            <linearGradient id="throughputStroke" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#8A2BE2" stopOpacity="1" />
              <stop offset="100%" stopColor="#4B0082" stopOpacity="1" />
            </linearGradient>
          </defs>

          <path
            d={`M ${pad} ${height - pad} L ${width - pad} ${height - pad}`}
            stroke="rgb(42 42 42)"
            strokeWidth="1"
          />

          <path d={path} fill="none" stroke="url(#throughputStroke)" strokeWidth="3" />

          {points.map((p, i) => {
            const { x, y } = toXY(i, p.done_cards);
            return (
              <circle
                key={p.date + i}
                cx={x}
                cy={y}
                r={4.5}
                fill="rgb(17 17 17)"
                stroke="rgb(160 32 240)"
                strokeWidth={2}
              />
            );
          })}
        </svg>
      </div>
    </div>
  );
}

