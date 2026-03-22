"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { getApiUrl } from "@/lib/api";

type Props = {
  open: boolean;
  onClose: () => void;
  token: string;
  spaceId: string;
  projectId?: string | null;
  refreshToken?: string;
  defaultName: string;
  language?: "ru" | "en";
  onTokensUpdated?: (tokens: { access: string; refresh?: string }) => void;
  onAuthExpired?: () => void;
  onCreated: (board: { id: string; name: string }, accessToken: string) => void;
};

type TemplateId = "simple" | "lanes" | "scrum";
type WizardStep = "pick" | "name";

const ACCENT = "#9C27B0";

const FIELD_SX_LIGHT = {
  "& .MuiOutlinedInput-notchedOutline": { borderColor: "#E0E0E0" },
  "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: "#BDBDBD" },
  "& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: ACCENT },
  "& label": { color: "#757575" },
  "& label.Mui-focused": { color: ACCENT },
} as const;

const FIELD_SX_DARK = {
  "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--k-border, #2A2A2A)" },
  "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: "rgba(160,160,160,0.35)" },
  "& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: "#9C27B0" },
  "& label": { color: "var(--k-text-muted, #A0A0A0)" },
  "& label.Mui-focused": { color: "#CE93D8" },
  "& .MuiInputBase-input.Mui-disabled": { WebkitTextFillColor: "var(--k-text-muted, #A0A0A0)" },
} as const;

function SimpleBoardPreview({ isDark, headers }: { isDark: boolean; headers: readonly [string, string, string] }) {
  const b = isDark ? "var(--k-border, #2A2A2A)" : "#E0E0E0";
  const muted = isDark ? "var(--k-text-muted)" : "#757575";
  const card = isDark ? "#616161" : "#BDBDBD";
  const cols = [
    { t: headers[0], n: 2 },
    { t: headers[1], n: 3 },
    { t: headers[2], n: 1 },
  ];
  return (
    <Box sx={{ display: "flex", gap: "6px", height: 148, mt: 2.5 }}>
      {cols.map((c) => (
        <Box
          key={c.t}
          sx={{
            flex: 1,
            border: `1px solid ${b}`,
            borderRadius: "4px",
            p: "6px 4px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            bgcolor: isDark ? "var(--k-page-bg, #0A0A0A)" : "#FAFAFA",
          }}
        >
          <Typography sx={{ fontSize: 10, fontWeight: 500, color: muted, lineHeight: 1.2, textAlign: "center" }}>
            {c.t}
          </Typography>
          <Box sx={{ flex: 1, display: "flex", flexDirection: "column", gap: "5px", width: "100%", mt: 1, justifyContent: "flex-start" }}>
            {Array.from({ length: c.n }).map((_, i) => (
              <Box key={i} sx={{ height: 10, bgcolor: card, borderRadius: "2px", width: "100%" }} />
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function LanesBoardPreview({
  isDark,
  laneLabels,
  colHeaders,
}: {
  isDark: boolean;
  laneLabels: [string, string];
  colHeaders: readonly [string, string, string];
}) {
  const b = isDark ? "var(--k-border, #2A2A2A)" : "#E0E0E0";
  const muted = isDark ? "var(--k-text-muted)" : "#757575";
  const card = isDark ? "#616161" : "#BDBDBD";
  const lanes = laneLabels;
  const headers = colHeaders;
  return (
    <Box sx={{ display: "flex", mt: 2.5, height: 156, gap: 0 }}>
      <Box sx={{ width: 22, flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "space-around", pr: 0.5 }}>
        {lanes.map((label) => (
          <Typography
            key={label}
            sx={{
              fontSize: 9,
              fontWeight: 600,
              color: muted,
              lineHeight: 1.1,
              writingMode: "vertical-rl",
              transform: "rotate(180deg)",
              textAlign: "center",
              maxHeight: 72,
            }}
          >
            {label}
          </Typography>
        ))}
      </Box>
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Box sx={{ display: "flex", gap: "4px", mb: "4px" }}>
          {headers.map((h) => (
            <Typography key={h} sx={{ flex: 1, fontSize: 9, fontWeight: 500, color: muted, textAlign: "center" }}>
              {h}
            </Typography>
          ))}
        </Box>
        <Box sx={{ display: "flex", flexDirection: "column", gap: "4px", flex: 1 }}>
          {[0, 1].map((row) => (
            <Box key={row} sx={{ display: "flex", gap: "4px", flex: 1 }}>
              {[0, 1, 2].map((col) => (
                <Box
                  key={col}
                  sx={{
                    flex: 1,
                    border: `1px solid ${b}`,
                    borderRadius: "3px",
                    p: "4px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                    justifyContent: "center",
                    bgcolor: isDark ? "var(--k-page-bg, #0A0A0A)" : "#FAFAFA",
                  }}
                >
                  {(row + col) % 2 === 0 ? (
                    <Box sx={{ height: 8, bgcolor: card, borderRadius: "2px", width: "85%", mx: "auto" }} />
                  ) : (
                    <>
                      <Box sx={{ height: 6, bgcolor: card, borderRadius: "2px", width: "70%", mx: "auto" }} />
                      <Box sx={{ height: 6, bgcolor: card, borderRadius: "2px", width: "55%", mx: "auto" }} />
                    </>
                  )}
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

function ScrumBoardPreview({
  isDark,
  queueLabel,
  sprintCols,
}: {
  isDark: boolean;
  queueLabel: string;
  sprintCols: readonly [string, string, string];
}) {
  const b = isDark ? "var(--k-border, #2A2A2A)" : "#E0E0E0";
  const muted = isDark ? "var(--k-text-muted)" : "#757575";
  const card = isDark ? "#616161" : "#BDBDBD";
  return (
    <Box sx={{ display: "flex", gap: "8px", height: 156, mt: 2.5 }}>
      <Box
        sx={{
          width: "22%",
          flexShrink: 0,
          border: `1px solid ${b}`,
          borderRadius: "4px",
          p: "6px 4px",
          bgcolor: isDark ? "var(--k-page-bg, #0A0A0A)" : "#FAFAFA",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Typography sx={{ fontSize: 9, fontWeight: 500, color: muted, textAlign: "center" }}>{queueLabel}</Typography>
        <Box sx={{ flex: 1, display: "flex", flexDirection: "column", gap: "5px", mt: 1 }}>
          <Box sx={{ height: 9, bgcolor: card, borderRadius: "2px" }} />
          <Box sx={{ height: 9, bgcolor: card, borderRadius: "2px" }} />
        </Box>
      </Box>
      <Box sx={{ flex: 1, display: "flex", gap: "5px", minWidth: 0 }}>
        {[
          { h: sprintCols[0], blocks: 2 },
          { h: sprintCols[1], blocks: 2 },
          { h: sprintCols[2], blocks: 1 },
        ].map((col) => (
          <Box
            key={col.h}
            sx={{
              flex: 1,
              border: `1px solid ${b}`,
              borderRadius: "4px",
              p: "6px 4px",
              bgcolor: isDark ? "var(--k-page-bg, #0A0A0A)" : "#FAFAFA",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <Typography sx={{ fontSize: 8.5, fontWeight: 500, color: muted, textAlign: "center", lineHeight: 1.15 }}>
              {col.h}
            </Typography>
            <Box sx={{ flex: 1, display: "flex", flexDirection: "column", gap: "5px", mt: 0.75 }}>
              {Array.from({ length: col.blocks }).map((_, i) => (
                <Box key={i} sx={{ height: 9, bgcolor: card, borderRadius: "2px" }} />
              ))}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export default function CreateBoardDialog({
  open,
  onClose,
  token,
  spaceId,
  projectId = null,
  refreshToken,
  defaultName,
  language = "ru",
  onTokensUpdated,
  onAuthExpired,
  onCreated,
}: Props) {
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";

  const ui = useMemo(() => {
    if (language === "en") {
      return {
        title: "New board",
        tabs: ["BASICS", "BLOCKS", "SCRUM AND KANBAN"] as const,
        p1: "Every process in your company consists of stages. A board is a visual representation of those stages — it helps you see which stage each piece of work is in.",
        p2: "As you use the product, you can create many boards for teams, tasks, and individuals. Choose the first process you want to visualize. The templates below will help you get started.",
        tabBlocksBody:
          "Stages are the basic building blocks of any process. On a board, each column usually corresponds to a stage: work moves from left to right until it is done.",
        tabScrumBody:
          "Scrum focuses on iterations and a predictable rhythm; Kanban limits work in progress and smooths flow. You can start with a simple board and refine columns and WIP limits later.",
        templateSimple: "Simple board",
        templateSimpleSub: "To do, Doing, Done",
        templateLanes: "Board with swimlanes",
        templateLanesSub: "3 columns + Urgent and Standard lanes",
        templateScrum: "Scrum",
        templateScrumSub: "Backlog and sprint boards",
        cancel: "Cancel",
        submit: "Create board",
        nameLabel: "Board name",
        nameRequired: "Enter a board name",
        backAria: "Back",
        queue: "Queue",
        inProgress: "In progress",
        done: "Done",
        urgent: "Urgent",
        normalPriority: "Normal priority",
        sprintBacklog: "Sprint backlog",
        colHeaders3: ["Queue", "In progress", "Done"] as const,
      };
    }
    return {
      title: "Новая доска",
      tabs: ["ОСНОВНЫЕ", "БЛОКИ", "SCRUM И KANBAN"] as const,
      p1: "Любой процесс в вашей компании состоит из этапов. Доска – это визуальное представление этих этапов, она помогает понять на каком этапе находится та или иная работа.",
      p2: "В процессе использования Kaiten, вы сможете создать много разных досок для разных команд, задач и отдельных людей, а сейчас выберите самый первый процесс, который хотите визуализировать. Шаблоны ниже, помогут вам начать визуализацию",
      tabBlocksBody:
        "Этапы — базовые блоки любого процесса. На доске каждая колонка обычно соответствует этапу: работа движется слева направо, пока не будет завершена.",
      tabScrumBody:
        "Scrum опирается на итерации и ритм спринтов, Kanban — на ограничение незавершённой работы и непрерывный поток. Можно начать с простой доски и затем настроить колонки и лимиты.",
      templateSimple: "Простая доска",
      templateSimpleSub: "Будем делать, Делаем, Готово",
      templateLanes: "Доска с дорожками",
      templateLanesSub: "3 колонки + дорожки Срочно и Стандартно",
      templateScrum: "Скрам",
      templateScrumSub: "Доски бэклога и спринта",
      cancel: "Отмена",
      submit: "Создать доску",
      nameLabel: "Название доски",
      nameRequired: "Введите название доски",
      backAria: "Назад",
      queue: "Очередь",
      inProgress: "В работе",
      done: "Готово",
      urgent: "Срочно",
      normalPriority: "Обычный приоритет",
      sprintBacklog: "Бэклог спринта",
      colHeaders3: ["Очередь", "В работе", "Готово"] as const,
    };
  }, [language]);

  const [tab, setTab] = useState(0);
  const [step, setStep] = useState<WizardStep>("pick");
  const [template, setTemplate] = useState<TemplateId | null>(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paperSx = useMemo(
    () => ({
      width: "100%",
      maxWidth: "min(1064px, calc(100vw - 64px))",
      m: { xs: 1.5, sm: 2 },
      borderRadius: "8px",
      boxShadow: isDark ? "0 24px 48px rgba(0,0,0,0.45)" : "0 8px 40px rgba(0,0,0,0.12)",
      bgcolor: isDark ? "var(--k-surface-bg, #111111)" : "#FFFFFF",
      color: isDark ? "var(--k-text, #E0E0E0)" : "#212121",
      border: isDark ? "1px solid var(--k-border, #2A2A2A)" : "1px solid #E8E8E8",
      backgroundImage: "none",
    }),
    [isDark],
  );

  const fieldSx = isDark ? FIELD_SX_DARK : FIELD_SX_LIGHT;

  useEffect(() => {
    if (open) {
      setTab(0);
      setStep("pick");
      setTemplate(null);
      setName(defaultName);
      setError(null);
    }
  }, [open, defaultName]);

  const inputSlotProps = useMemo(
    () => ({
      input: { sx: { color: isDark ? "var(--k-text, #E0E0E0)" : "#212121" } },
    }),
    [isDark],
  );

  const selectTemplate = (id: TemplateId) => {
    setTemplate(id);
    setStep("name");
    setError(null);
  };

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(ui.nameRequired);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        name: trimmed,
        space_id: spaceId,
      };
      if (projectId) body.project_id = projectId;

      const createBoard = async (accessToken: string) =>
        fetch(getApiUrl("/api/kanban/boards"), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "X-Space-Id": spaceId,
          },
          body: JSON.stringify(body),
        });

      let accessUsed = token;
      let res = await createBoard(accessUsed);
      let data: any = await res.json().catch(() => ({}));

      if (!res.ok && res.status === 401 && data?.detail === "invalid_token") {
        if (!refreshToken) {
          onAuthExpired?.();
          throw new Error(language === "en" ? "Session expired. Sign in again." : "Сессия истекла. Войдите заново.");
        }
        const refreshRes = await fetch(getApiUrl("/api/auth/refresh"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh: refreshToken }),
        });
        const refreshData: any = await refreshRes.json().catch(() => ({}));
        if (!refreshRes.ok || !refreshData?.access) {
          onAuthExpired?.();
          throw new Error(language === "en" ? "Session expired. Sign in again." : "Сессия истекла. Войдите заново.");
        }
        onTokensUpdated?.({ access: refreshData.access, refresh: refreshData.refresh });
        accessUsed = refreshData.access as string;
        res = await createBoard(accessUsed);
        data = await res.json().catch(() => ({}));
      }

      if (!res.ok) {
        throw new Error(
          data?.detail || (language === "en" ? "Could not create board" : "Не удалось создать доску"),
        );
      }

      onCreated({ id: data.id, name: data.name ?? trimmed }, accessUsed);
      setName("");
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : language === "en" ? "Error" : "Ошибка";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const tabTextPrimary = isDark ? "var(--k-text)" : "#212121";
  const tabTextInactive = isDark ? "var(--k-text-muted)" : "#757575";
  const bodyText = isDark ? "var(--k-text-muted)" : "#5F6368";
  const divider = isDark ? "var(--k-border)" : "#E0E0E0";

  const colH = ui.colHeaders3;
  const templates: {
    id: TemplateId;
    title: string;
    sub: string;
    renderPreview: () => ReactNode;
  }[] = [
    {
      id: "simple",
      title: ui.templateSimple,
      sub: ui.templateSimpleSub,
      renderPreview: () => <SimpleBoardPreview isDark={isDark} headers={colH} />,
    },
    {
      id: "lanes",
      title: ui.templateLanes,
      sub: ui.templateLanesSub,
      renderPreview: () => (
        <LanesBoardPreview isDark={isDark} laneLabels={[ui.urgent, ui.normalPriority]} colHeaders={colH} />
      ),
    },
    {
      id: "scrum",
      title: ui.templateScrum,
      sub: ui.templateScrumSub,
      renderPreview: () => (
        <ScrumBoardPreview isDark={isDark} queueLabel={ui.queue} sprintCols={[ui.sprintBacklog, ui.inProgress, ui.done]} />
      ),
    },
  ];

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (loading) return;
        onClose();
      }}
      maxWidth={false}
      fullWidth
      scroll="paper"
      sx={{ zIndex: theme.zIndex.modal + 20 }}
      slotProps={{
        paper: { sx: paperSx },
      }}
    >
      <DialogTitle
        sx={{
          px: { xs: 2, sm: "32px" },
          pt: { xs: 2, sm: "24px" },
          pb: step === "pick" ? 1 : 1.5,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          {step === "name" ? (
            <IconButton
              aria-label={ui.backAria}
              onClick={() => {
                setStep("pick");
                setTemplate(null);
                setError(null);
              }}
              disabled={loading}
              size="small"
              sx={{ mr: 0.5, color: tabTextPrimary }}
            >
              <ArrowBackIcon fontSize="small" />
            </IconButton>
          ) : null}
          <Typography
            component="span"
            sx={{
              fontWeight: 600,
              fontSize: "20px",
              lineHeight: 1.3,
              letterSpacing: "-0.01em",
              color: tabTextPrimary,
            }}
          >
            {ui.title}
          </Typography>
        </Box>

        {step === "pick" ? (
          <Box sx={{ mt: 1.5, mx: { xs: -1, sm: -0.5 } }}>
            <Tabs
              value={tab}
              onChange={(_, v) => setTab(v)}
              variant="fullWidth"
              sx={{
                minHeight: 44,
                "& .MuiTabs-flexContainer": { gap: 0 },
                "& .MuiTab-root": {
                  textTransform: "uppercase",
                  fontWeight: 600,
                  fontSize: "12px",
                  letterSpacing: "0.06em",
                  minHeight: 44,
                  py: 1,
                  color: tabTextInactive,
                  "&.Mui-selected": {
                    color: ACCENT,
                  },
                },
                "& .MuiTabs-indicator": {
                  height: 3,
                  backgroundColor: ACCENT,
                  borderRadius: "1px 1px 0 0",
                },
              }}
            >
              <Tab disableRipple label={ui.tabs[0]} />
              <Tab disableRipple label={ui.tabs[1]} />
              <Tab disableRipple label={ui.tabs[2]} />
            </Tabs>
            <Box sx={{ height: "1px", bgcolor: divider, width: "100%" }} />
          </Box>
        ) : null}
      </DialogTitle>

      <DialogContent
        sx={{
          px: { xs: 2, sm: "32px" },
          pt: step === "pick" ? "20px" : 2,
          pb: step === "pick" ? "28px" : 2,
          minHeight: { md: step === "pick" ? 434 : "auto" },
          maxHeight: "min(78vh, 640px)",
          overflowY: "auto",
        }}
      >
        {step === "pick" && tab === 0 ? (
          <>
            <Typography
              sx={{
                color: bodyText,
                fontSize: "15px",
                lineHeight: 1.65,
                fontWeight: 400,
                maxWidth: "100%",
              }}
            >
              {ui.p1}
            </Typography>
            <Typography
              sx={{
                color: bodyText,
                fontSize: "15px",
                lineHeight: 1.65,
                fontWeight: 400,
                mt: 2.5,
                maxWidth: "100%",
              }}
            >
              {ui.p2}
            </Typography>

            <Box
              sx={{
                display: "flex",
                mt: 3.5,
                mx: { xs: -1, sm: -2 },
                borderTop: `1px solid ${divider}`,
                borderBottom: `1px solid ${divider}`,
              }}
            >
              {templates.map((item, index) => {
                return (
                  <Box
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => selectTemplate(item.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        selectTemplate(item.id);
                      }
                    }}
                    sx={{
                      flex: 1,
                      minWidth: 0,
                      px: { xs: 1.5, sm: 2.5 },
                      py: 2.5,
                      cursor: "pointer",
                      borderRight: index < templates.length - 1 ? `1px solid ${divider}` : "none",
                      transition: "background-color 0.15s ease",
                      "&:hover": {
                        bgcolor: isDark ? "rgba(255,255,255,0.04)" : "rgba(156, 39, 176, 0.04)",
                      },
                    }}
                  >
                    <Typography sx={{ fontSize: "16px", fontWeight: 600, color: tabTextPrimary, lineHeight: 1.3 }}>
                      {item.title}
                    </Typography>
                    <Typography sx={{ fontSize: "13px", color: bodyText, mt: 0.75, lineHeight: 1.45 }}>{item.sub}</Typography>
                    {item.renderPreview()}
                  </Box>
                );
              })}
            </Box>
          </>
        ) : null}

        {step === "pick" && tab === 1 ? (
          <Typography sx={{ color: bodyText, fontSize: "15px", lineHeight: 1.65, pt: 1 }}>{ui.tabBlocksBody}</Typography>
        ) : null}

        {step === "pick" && tab === 2 ? (
          <Typography sx={{ color: bodyText, fontSize: "15px", lineHeight: 1.65, pt: 1 }}>{ui.tabScrumBody}</Typography>
        ) : null}

        {step === "name" ? (
          <Box sx={{ pt: 0.5 }}>
            {template ? (
              <Typography sx={{ fontSize: "14px", color: bodyText, mb: 2 }}>
                {template === "simple" && ui.templateSimple}
                {template === "lanes" && ui.templateLanes}
                {template === "scrum" && ui.templateScrum}
              </Typography>
            ) : null}
            <TextField
              autoFocus
              fullWidth
              label={ui.nameLabel}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              error={!!error}
              helperText={error}
              disabled={loading}
              margin="normal"
              slotProps={inputSlotProps}
              FormHelperTextProps={{ sx: { color: error ? "error.main" : bodyText } }}
              sx={{ ...fieldSx, mt: 0 }}
            />
          </Box>
        ) : null}
      </DialogContent>

      <DialogActions
        sx={{
          px: { xs: 2, sm: "32px" },
          pb: { xs: 2, sm: "20px" },
          pt: step === "pick" ? 1 : 2,
          justifyContent: "flex-end",
        }}
      >
        {step === "pick" ? (
          <Button
            onClick={onClose}
            disabled={loading}
            sx={{
              color: tabTextPrimary,
              fontWeight: 700,
              fontSize: "13px",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              minWidth: "auto",
              px: 1,
            }}
          >
            {ui.cancel}
          </Button>
        ) : (
          <>
            <Button
              onClick={onClose}
              disabled={loading}
              sx={{
                color: tabTextPrimary,
                fontWeight: 600,
                fontSize: "14px",
                textTransform: "none",
              }}
            >
              {ui.cancel}
            </Button>
            <Button
              onClick={handleCreate}
              variant="contained"
              disabled={loading}
              sx={{
                borderRadius: "4px",
                px: 2.5,
                py: 1,
                fontWeight: 600,
                textTransform: "none",
                fontSize: "14px",
                bgcolor: ACCENT,
                boxShadow: "none",
                "&:hover": { bgcolor: "#7B1FA2", boxShadow: "none" },
              }}
            >
              {loading ? <CircularProgress size={22} sx={{ color: "#fff" }} /> : ui.submit}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
