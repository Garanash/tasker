"use client";

import { Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography, Paper } from "@mui/material";

type Card = {
  id: string;
  title: string;
  column_id: string;
  column_name?: string;
  track_name?: string;
  assignee_name?: string | null;
  due_at?: string | null;
  size?: number;
};

type Props = {
  cards: Card[];
  onCardClick?: (cardId: string) => void;
  locale?: "ru" | "en";
};

export default function TableView({ cards, onCardClick, locale = "ru" }: Props) {
  const t =
    locale === "en"
      ? {
          download: "DOWNLOAD",
          settings: "SETTINGS",
          title: "Title",
          id: "ID",
          track: "Track",
          column: "Column",
          assignee: "Assignee",
          size: "Size",
          due: "Due",
          noCards: "No cards",
          totals: "Numeric field totals",
        }
      : {
          download: "СКАЧАТЬ",
          settings: "НАСТРОЙКИ",
          title: "Название",
          id: "ID",
          track: "Дорожка",
          column: "Колонка",
          assignee: "Ответственный",
          size: "Размер",
          due: "Срок",
          noCards: "Нет карточек",
          totals: "Суммы цифровых полей",
        };
  const escapeCsv = (value: unknown): string => {
    const raw = value == null ? "" : String(value);
    return `"${raw.replace(/"/g, '""')}"`;
  };
  const mapRows = () =>
    cards.map((card) => ({
      title: card.title || "",
      id: card.id.slice(0, 8),
      track: card.track_name || "—",
      column: card.column_name || "—",
      assignee: card.assignee_name || "—",
      size: card.size ?? "—",
      due: card.due_at ? new Date(card.due_at).toLocaleDateString(locale === "en" ? "en-US" : "ru-RU") : "—",
    }));
  const downloadTableCsv = () => {
    const rows = mapRows();
    const headers = [t.title, t.id, t.track, t.column, t.assignee, t.size, t.due];
    const lines = [
      headers.map(escapeCsv).join(","),
      ...rows.map((r) => [r.title, r.id, r.track, r.column, r.assignee, r.size, r.due].map(escapeCsv).join(",")),
    ];
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = locale === "en" ? "kanban-table-report.csv" : "kanban-таблица.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };
  const openTablePrintForm = () => {
    const rows = mapRows();
    const title = locale === "en" ? "Kanban Table Report" : "Табличный отчет Kanban";
    const generatedAt = new Date().toLocaleString(locale === "en" ? "en-US" : "ru-RU");
    const htmlRows = rows
      .map(
        (r) => `
        <tr>
          <td>${r.title}</td>
          <td>${r.id}</td>
          <td>${r.track}</td>
          <td>${r.column}</td>
          <td>${r.assignee}</td>
          <td>${r.size}</td>
          <td>${r.due}</td>
        </tr>`
      )
      .join("");
    const win = window.open("", "_blank", "noopener,noreferrer,width=1200,height=860");
    if (!win) return;
    win.document.write(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8"/>
          <title>${title}</title>
          <style>
            body { font-family: Inter, -apple-system, Segoe UI, Roboto, sans-serif; margin: 24px; color: #111; }
            h1 { margin: 0 0 8px; font-size: 24px; }
            .meta { margin: 0 0 16px; color: #555; font-size: 12px; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { border: 1px solid #cfd2d7; padding: 8px; text-align: left; vertical-align: top; }
            th { background: #f3f4f6; font-weight: 700; }
            tr:nth-child(even) td { background: #fafafa; }
          </style>
        </head>
        <body>
          <h1>${title}</h1>
          <div class="meta">${generatedAt}</div>
          <table>
            <thead>
              <tr>
                <th>${t.title}</th><th>${t.id}</th><th>${t.track}</th><th>${t.column}</th><th>${t.assignee}</th><th>${t.size}</th><th>${t.due}</th>
              </tr>
            </thead>
            <tbody>${htmlRows}</tbody>
          </table>
        </body>
      </html>
    `);
    win.document.close();
    win.focus();
  };
  return (
    <Box sx={{ flex: 1, overflow: "auto", p: 2, bgcolor: "rgba(127,127,127,0.12)" }}>
      <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mb: 2 }}>
        <Box
          component="button"
          onClick={downloadTableCsv}
          sx={{
            px: 2,
            py: 1,
            bgcolor: "var(--k-surface-bg)",
            color: "var(--k-text)",
            border: "1px solid var(--k-border)",
            borderRadius: 1,
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            "&:hover": { bgcolor: "rgba(127,127,127,0.12)" },
          }}
        >
          ⬇ {t.download}
        </Box>
        <Box
          component="button"
          onClick={openTablePrintForm}
          sx={{
            px: 2,
            py: 1,
            bgcolor: "var(--k-surface-bg)",
            color: "var(--k-text)",
            border: "1px solid var(--k-border)",
            borderRadius: 1,
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            "&:hover": { bgcolor: "rgba(127,127,127,0.12)" },
          }}
        >
          ⚙ {t.settings}
        </Box>
      </Box>
      <TableContainer component={Paper} sx={{ borderRadius: 2, border: "1px solid var(--k-border)", bgcolor: "var(--k-surface-bg)" }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: "rgba(127,127,127,0.12)" }}>
              <TableCell sx={{ fontWeight: 600, color: "var(--k-text-muted)", fontSize: 12, width: 40 }}></TableCell>
              <TableCell sx={{ fontWeight: 600, color: "var(--k-text-muted)", fontSize: 12 }}>{t.title}</TableCell>
              <TableCell sx={{ fontWeight: 600, color: "var(--k-text-muted)", fontSize: 12 }}>{t.id}</TableCell>
              <TableCell sx={{ fontWeight: 600, color: "var(--k-text-muted)", fontSize: 12 }}>{t.track}</TableCell>
              <TableCell sx={{ fontWeight: 600, color: "var(--k-text-muted)", fontSize: 12 }}>{t.column}</TableCell>
              <TableCell sx={{ fontWeight: 600, color: "var(--k-text-muted)", fontSize: 12 }}>{t.assignee}</TableCell>
              <TableCell sx={{ fontWeight: 600, color: "var(--k-text-muted)", fontSize: 12 }}>{t.size}</TableCell>
              <TableCell sx={{ fontWeight: 600, color: "var(--k-text-muted)", fontSize: 12 }}>{t.due}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {cards.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} sx={{ textAlign: "center", color: "var(--k-text-muted)", py: 4 }}>
                  {t.noCards}
                </TableCell>
              </TableRow>
            ) : (
              cards.map((card) => (
                <TableRow
                  key={card.id}
                  hover
                  onClick={() => onCardClick?.(card.id)}
                  sx={{ cursor: "pointer" }}
                >
                  <TableCell>
                    <Typography sx={{ color: "#9C27B0", fontSize: 12 }}>▸</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography sx={{ color: "var(--k-text)", fontSize: 14 }}>{card.title}</Typography>
                  </TableCell>
                  <TableCell sx={{ color: "var(--k-text-muted)", fontSize: 13 }}>{card.id.slice(0, 8)}</TableCell>
                  <TableCell sx={{ color: "var(--k-text-muted)", fontSize: 13 }}>{card.track_name || "—"}</TableCell>
                  <TableCell sx={{ color: "var(--k-text-muted)", fontSize: 13 }}>{card.column_name || "—"}</TableCell>
                  <TableCell sx={{ color: "var(--k-text-muted)", fontSize: 13 }}>{card.assignee_name || "—"}</TableCell>
                  <TableCell sx={{ color: "var(--k-text-muted)", fontSize: 13 }}>{card.size ?? "—"}</TableCell>
                  <TableCell sx={{ color: "var(--k-text-muted)", fontSize: 13 }}>
                    {card.due_at ? new Date(card.due_at).toLocaleDateString(locale === "en" ? "en-US" : "ru-RU") : "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <Box sx={{ mt: 2, color: "var(--k-text-muted)", fontSize: 12 }}>
        {t.totals} ⓘ <span style={{ marginLeft: 200 }}>0</span>
      </Box>
    </Box>
  );
}
