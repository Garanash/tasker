"use client";

import { Box, IconButton, Tooltip, Divider, Badge } from "@mui/material";
import GridViewIcon from "@mui/icons-material/GridView";
import FilterListIcon from "@mui/icons-material/FilterList";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import BarChartOutlinedIcon from "@mui/icons-material/BarChartOutlined";
import ArchiveOutlinedIcon from "@mui/icons-material/ArchiveOutlined";

const TEXT_GRAY = "var(--k-text-muted)";
const TEXT_DARK = "var(--k-text)";
const BORDER_GRAY = "var(--k-border)";
const LIGHT_BG = "var(--k-surface-bg)";
const ACCENT_BLUE = "#1976D2";

type Props = {
  activeTabId?: string;
  onTabChange?: (tabId: string) => void;
  unreadNotificationsCount?: number;
  language?: "ru" | "en";
};

const RAIL_ITEMS = [
  { id: "lists", icon: <GridViewIcon sx={{ fontSize: 20 }} /> },
  { id: "filters", icon: <FilterListIcon sx={{ fontSize: 20 }} /> },
  { id: "settings", icon: <DescriptionOutlinedIcon sx={{ fontSize: 20 }} /> },
  { id: "reports", icon: <BarChartOutlinedIcon sx={{ fontSize: 20 }} /> },
  { id: "archive", icon: <ArchiveOutlinedIcon sx={{ fontSize: 20 }} /> },
] as const;

export default function RightRail({ activeTabId, onTabChange, unreadNotificationsCount = 0, language = "ru" }: Props) {
  const t =
    language === "en"
      ? {
          lists: "Board",
          filters: "Filters",
          settings: "Documents",
          reports: "Reports",
          archive: "Archive",
          notifications: "Unread notifications",
        }
      : {
          lists: "Доска",
          filters: "Фильтры",
          settings: "Документы",
          reports: "Отчеты",
          archive: "Архив",
          notifications: "Непрочитанные уведомления",
        };
  const localizedItems = [
    { ...RAIL_ITEMS[0], title: t.lists },
    { ...RAIL_ITEMS[1], title: t.filters },
    { ...RAIL_ITEMS[2], title: t.settings },
    { ...RAIL_ITEMS[3], title: t.reports },
    { ...RAIL_ITEMS[4], title: t.archive },
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
      {/* Номер с задачами */}
      <Tooltip title={t.notifications} placement="left" arrow>
        <Badge badgeContent={unreadNotificationsCount} color="error" max={99}>
          <Box
            sx={{
              width: 28,
              height: 28,
              bgcolor: "#E3F2FD",
              color: ACCENT_BLUE,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              fontWeight: 600,
              mb: 1,
            }}
            aria-label={t.notifications}
          >
            {Math.max(0, unreadNotificationsCount)}
          </Box>
        </Badge>
      </Tooltip>

      <Divider sx={{ width: 32, mb: 1, borderColor: BORDER_GRAY }} />

      {/* Основные кнопки */}
      <Box
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 0.25,
          overflow: "auto",
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
