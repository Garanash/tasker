"use client";

import { Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography, Paper } from "@mui/material";

type Card = {
  id: string;
  title: string;
  column_id: string;
  column_name?: string;
  track_name?: string;
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
          size: "Размер",
          due: "Срок",
          noCards: "Нет карточек",
          totals: "Суммы цифровых полей",
        };
  return (
    <Box sx={{ flex: 1, overflow: "auto", p: 2, bgcolor: "rgba(127,127,127,0.12)" }}>
      <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mb: 2 }}>
        <Box
          component="button"
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
              <TableCell sx={{ fontWeight: 600, color: "var(--k-text-muted)", fontSize: 12 }}>{t.size}</TableCell>
              <TableCell sx={{ fontWeight: 600, color: "var(--k-text-muted)", fontSize: 12 }}>{t.due}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {cards.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} sx={{ textAlign: "center", color: "var(--k-text-muted)", py: 4 }}>
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
