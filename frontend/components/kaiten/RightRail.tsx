"use client";

import { Box, IconButton, Tooltip } from "@mui/material";
import GridViewIcon from "@mui/icons-material/GridView";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import BarChartOutlinedIcon from "@mui/icons-material/BarChartOutlined";
import ArchiveOutlinedIcon from "@mui/icons-material/ArchiveOutlined";

const TEXT_GRAY = "var(--k-text-muted)";
const TEXT_DARK = "var(--k-text)";
const BORDER_GRAY = "var(--k-border)";
const LIGHT_BG = "var(--k-surface-bg)";

type Props = {
  activeTabId?: string;
  onTabChange?: (tabId: string) => void;
  language?: "ru" | "en";
};

const RAIL_ITEMS = [
  { id: "lists", icon: <GridViewIcon sx={{ fontSize: 20 }} /> },
  { id: "settings", icon: <DescriptionOutlinedIcon sx={{ fontSize: 20 }} /> },
  { id: "reports", icon: <BarChartOutlinedIcon sx={{ fontSize: 20 }} /> },
  { id: "archive", icon: <ArchiveOutlinedIcon sx={{ fontSize: 20 }} /> },
] as const;

export default function RightRail({ activeTabId, onTabChange, language = "ru" }: Props) {
  const t =
    language === "en"
      ? {
          lists: "Tasks",
          settings: "Documents",
          reports: "Reports",
          archive: "Archive",
        }
      : {
          lists: "Задачи",
          settings: "Документы",
          reports: "Отчеты",
          archive: "Архив",
        };
  const localizedItems = [
    { ...RAIL_ITEMS[0], title: t.lists },
    { ...RAIL_ITEMS[1], title: t.settings },
    { ...RAIL_ITEMS[2], title: t.reports },
    { ...RAIL_ITEMS[3], title: t.archive },
  ];
  return (
    <Box
      data-testid="right-rail"
      data-tour="sidebar-fingers"
      sx={{
        width: 53,
        flexShrink: 0,
        borderLeft: `1px solid ${BORDER_GRAY}`,
        bgcolor: LIGHT_BG,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        py: 1,
      }}
    >
      <Box
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 0.25,
          overflow: "auto",
          width: "100%",
        }}
      >
        {localizedItems.map((item) => (
          <Tooltip key={item.id} title={item.title} placement="left" arrow>
            <IconButton
              size="small"
              onClick={() => onTabChange?.(item.id)}
              sx={{
                width: 40,
                height: 40,
                color: activeTabId === item.id ? TEXT_DARK : TEXT_GRAY,
                bgcolor: activeTabId === item.id ? "var(--k-active, #E8E8E8)" : "transparent",
                borderRadius: 1,
                "&:hover": { bgcolor: "var(--k-hover, #F5F5F5)" },
              }}
            >
              {item.icon}
            </IconButton>
          </Tooltip>
        ))}
      </Box>
    </Box>
  );
}
