"use client";

import { Box, Typography, Collapse, IconButton } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import { useState } from "react";

type Card = {
  id: string;
  title: string;
  column_id: string;
  due_at?: string | null;
};

type Column = {
  id: string;
  name: string;
  cards: Card[];
};

type Board = {
  id: string;
  name: string;
  columns: Column[];
};

type Props = {
  boards: Board[];
  onCardClick?: (cardId: string) => void;
  locale?: "ru" | "en";
};

export default function ListView({ boards, onCardClick, locale = "ru" }: Props) {
  const t =
    locale === "en"
      ? {
          cards: "cards",
          done: "Done",
          inProgress: "In progress",
        }
      : {
          cards: "карточек",
          done: "Готово",
          inProgress: "В работе",
        };
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggle = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <Box sx={{ flex: 1, overflow: "auto", p: 2, bgcolor: "rgba(127,127,127,0.12)" }}>
      {boards.map((board) => (
        <Box key={board.id} sx={{ mb: 3 }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              cursor: "pointer",
              py: 1,
              px: 2,
              bgcolor: "var(--k-surface-bg)",
              borderRadius: 1,
              border: "1px solid var(--k-border)",
              "&:hover": { bgcolor: "rgba(127,127,127,0.12)" },
            }}
            onClick={() => toggle(board.id)}
          >
            <IconButton size="small">
              {expanded[board.id] !== false ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            </IconButton>
            <Typography sx={{ fontWeight: 600, color: "#9C27B0" }}>{board.name}</Typography>
            <Typography sx={{ ml: "auto", color: "var(--k-text-muted)", fontSize: 12 }}>
              {board.columns.reduce((acc, col) => acc + col.cards.length, 0)}{" "}
              {t.cards}
            </Typography>
          </Box>
          <Collapse in={expanded[board.id] !== false}>
            <Box sx={{ pl: 4, mt: 1 }}>
              {board.columns.map((col) =>
                col.cards.map((card) => (
                  <Box
                    key={card.id}
                    onClick={() => onCardClick?.(card.id)}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 2,
                      py: 1,
                      px: 2,
                      bgcolor: "var(--k-surface-bg)",
                      borderRadius: 1,
                      border: "1px solid var(--k-border)",
                      mb: 0.5,
                      cursor: "pointer",
                      "&:hover": { bgcolor: "rgba(127,127,127,0.12)" },
                    }}
                  >
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        bgcolor: col.name === "Done" || col.name === t.done ? "#4CAF50" : col.name === "In Progress" || col.name === t.inProgress ? "#FF9800" : "var(--k-text-muted)",
                      }}
                    />
                    <Typography sx={{ flex: 1, fontSize: 14, color: "var(--k-text)" }}>{card.title}</Typography>
                    <Typography sx={{ color: "var(--k-text-muted)", fontSize: 12 }}>{col.name}</Typography>
                  </Box>
                ))
              )}
            </Box>
          </Collapse>
        </Box>
      ))}
    </Box>
  );
}
