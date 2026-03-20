"use client";

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import AddIcon from "@mui/icons-material/Add";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
import BugReportOutlinedIcon from "@mui/icons-material/BugReportOutlined";
import LightbulbOutlinedIcon from "@mui/icons-material/LightbulbOutlined";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Chip,
  Box,
  Typography,
  CircularProgress,
} from "@mui/material";
import { normalizeTaskCardType, type TaskCardTypeId } from "./cardTaskTypes";
import { MarkdownDescriptionPreview } from "./MarkdownDescriptionPreview";

export type CardDetailChecklistItem = {
  id: string;
  title: string;
  is_done: boolean;
};

export type CardDetailChecklist = {
  id: string;
  title: string;
  items: CardDetailChecklistItem[];
};

export type CardDetailAttachment = {
  id: string;
  file_name: string;
  file_url: string;
  content_type: string;
  size_bytes: number | null;
  created_at: string;
};

export type CardDetail = {
  id: string;
  title: string;
  description: string;
  card_type: string;
  created_at?: string | null;
  due_at: string | null;
  track_id: string | null;
  board_id?: string;
  board_name?: string;
  space_id?: string;
  space_name?: string;
  column_id: string;
  column_name?: string;
  column_is_done?: boolean;
  planned_start_at: string | null;
  planned_end_at: string | null;
  estimate_points: number | null;
  is_favorite?: boolean;
  field_values: Array<{
    id: string;
    definition_id: string;
    key: string;
    name: string;
    value: unknown;
    updated_at: string;
  }>;
  checklists: CardDetailChecklist[];
  attachments: CardDetailAttachment[];
  comments: Array<{
    id: string;
    author_id: string;
    author_full_name: string;
    author_email: string;
    body: string;
    created_at: string;
  }>;
};

const PARTICIPANT_FIELD_KEY = "participant_user_ids";

function parseParticipantUserIds(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v) as unknown;
      if (Array.isArray(p)) return p.map(String).filter(Boolean);
    } catch {
      /* ignore */
    }
  }
  return [];
}

function TaskTypeIcon({ type, size = 22 }: { type: TaskCardTypeId; size?: number }) {
  const sx = { fontSize: size };
  if (type === "bug") return <BugReportOutlinedIcon sx={{ ...sx, color: "#e53935" }} />;
  if (type === "feature") return <LightbulbOutlinedIcon sx={{ ...sx, color: "#1e88e5" }} />;
  return <MenuBookOutlinedIcon sx={{ ...sx, color: "#9e9e9e" }} />;
}

export function CardModal({
  card,
  onClose,
  onAddComment,
  onUploadAttachment,
  onAddAttachmentUrl,
  onAddChecklist,
  onAddChecklistItem,
  onToggleChecklistItem,
  onUpdateCard,
  onDeleteCard,
  onUpsertFieldValue,
  users = [],
  availableColumns = [],
  isFavorite = false,
  onToggleFavorite,
  onCreateRelatedCard,
  locale = "ru",
}: {
  card: CardDetail;
  onClose: () => void;
  onAddComment?: (body: string) => Promise<void>;
  onUploadAttachment?: (file: File) => Promise<void>;
  onAddAttachmentUrl?: (payload: { file_url: string; file_name?: string }) => Promise<void>;
  onAddChecklist?: (title: string) => Promise<{ id: string } | void>;
  onAddChecklistItem?: (checklistId: string, title: string) => Promise<void>;
  onToggleChecklistItem?: (itemId: string, isDone: boolean) => Promise<void>;
  onUpdateCard?: (patch: {
    title?: string;
    description?: string;
    column_id?: string;
    planned_start_at?: string | null;
    planned_end_at?: string | null;
    estimate_points?: number | null;
    card_type?: string;
  }) => Promise<void>;
  onDeleteCard?: () => Promise<void>;
  onUpsertFieldValue?: (payload: {
    key: string;
    name: string;
    value: unknown;
    field_type?: string;
  }) => Promise<void>;
  users?: Array<{ id: string; email: string; full_name: string; role: "user" | "executor" | "manager" | "lead" | "admin" }>;
  availableColumns?: Array<{ id: string; name: string; is_done: boolean }>;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  onCreateRelatedCard?: () => void;
  locale?: "ru" | "en";
}) {
  const t =
    locale === "en"
      ? {
          close: "Close",
          done: "DONE",
          location: "Location",
          type: "Type",
          participants: "Participants",
          assignee: "Assignee",
          description: "Description",
          plan: "Plan",
          estimate: "Estimate",
          start: "Start",
          end: "End",
          points: "pts",
          checklists: "Checklists",
          noChecklists: "No checklists yet",
          addChecklist: "Add checklist",
          addItem: "Add item",
          fields: "Fields",
          noFields: "No fields yet",
          attachments: "Attachments",
          upload: "Upload file",
          link: "Link",
          open: "Open",
          noAttachments: "No attachments",
          comments: "Comments",
          noComments: "No comments yet",
          writeComment: "Write a comment...",
          send: "Send",
          sending: "Sending...",
          cancel: "Cancel",
          add: "Add",
          adding: "Adding...",
          fileNameOptional: "File name (optional)",
          addByUrl: "Add attachment by URL",
          created: "Created",
          justNow: "just now",
          all: "All",
          save: "Save",
          delete: "Delete",
          savingTitle: "Saving title…",
          currentType: "Current type",
          changeType: "Change type",
          typeCard: "Card",
          typeBug: "Bug",
          typeFeature: "Feature",
          addParticipant: "Add participant",
          blockCard: "Block card",
          blockReasonLabel: "Reason for blocking",
          blockReasonRequired: "Enter the reason — blocking is not allowed without it.",
          confirmBlock: "Block",
          column: "Column",
          addToCard: "Add to card",
          attachmentsLinks: "Attachments & links",
          addMenuDue: "Due date",
          addMenuTags: "Tags (quick edit)",
          addMenuChecklist: "Checklist",
          addMenuLink: "Link (URL)",
          addMenuFile: "Upload file",
          addMenuParent: "Parent card ID",
          addMenuChild: "Create child card",
          addMenuAcceptance: "Acceptance criteria checklist",
          addMenuGdrive: "Google Drive link",
          addMenuDropbox: "Dropbox link",
          addMenuNewField: "Custom field",
          addMenuTimeSpent: "Time spent (minutes)",
          addMenuSize: "Size",
          addMenuTimeline: "Timeline note",
          checklistModalTitle: "New checklist",
          checklistNameLabel: "Title",
          checklistModeCheckbox: "Checkboxes",
          checklistModePoll: "Poll (options)",
          checklistOptionsPlaceholder: "Options, one per line (for poll)",
          createChecklist: "Create",
          descEditTab: "Edit",
          descPreviewTab: "Preview",
          descMarkdownHint:
            "Markdown: **bold**, lists, links, `code`, tables, headings — saved as plain text.",
          descPreviewEmpty: "Nothing to preview yet.",
        }
      : {
          close: "Закрыть",
          done: "ГОТОВО",
          location: "Расположение",
          type: "Тип",
          participants: "Участники",
          assignee: "Ответственный",
          description: "Описание",
          plan: "План",
          estimate: "Оценка",
          start: "Старт",
          end: "Финиш",
          points: "очк.",
          checklists: "Чек-листы",
          noChecklists: "Пока нет чек-листов",
          addChecklist: "Добавить чек-лист",
          addItem: "Добавить пункт",
          fields: "Поля",
          noFields: "Пока нет полей",
          attachments: "Вложения",
          upload: "Загрузить файл",
          link: "Ссылка",
          open: "Открыть",
          noAttachments: "Нет вложений",
          comments: "Комментарии",
          noComments: "Пока нет комментариев",
          writeComment: "Написать комментарий...",
          send: "Отправить",
          sending: "Отправка...",
          cancel: "Отмена",
          add: "Добавить",
          adding: "Добавляем...",
          fileNameOptional: "Имя файла (опционально)",
          addByUrl: "Добавить вложение по URL",
          created: "Создана",
          justNow: "только что",
          all: "Все",
          save: "Сохранить",
          delete: "Удалить",
          savingTitle: "Сохранение названия…",
          currentType: "Текущий тип",
          changeType: "Изменить тип",
          typeCard: "Карточка",
          typeBug: "Баг",
          typeFeature: "Фича",
          addParticipant: "Добавить участника",
          blockCard: "Заблокировать карточку",
          blockReasonLabel: "Причина блокировки",
          blockReasonRequired: "Укажите причину — без неё блокировку поставить нельзя.",
          confirmBlock: "Заблокировать",
          column: "Колонка",
          addToCard: "Добавить к карточке",
          attachmentsLinks: "Вложения и ссылки",
          addMenuDue: "Срок (дата окончания)",
          addMenuTags: "Теги (быстро)",
          addMenuChecklist: "Чек-лист",
          addMenuLink: "Ссылка (URL)",
          addMenuFile: "Загрузить файл",
          addMenuParent: "ID родительской карточки",
          addMenuChild: "Создать дочернюю карточку",
          addMenuAcceptance: "Чек-лист критериев приёмки",
          addMenuGdrive: "Ссылка Google Drive",
          addMenuDropbox: "Ссылка Dropbox",
          addMenuNewField: "Произвольное поле",
          addMenuTimeSpent: "Трудозатраты (мин.)",
          addMenuSize: "Размер",
          addMenuTimeline: "Заметка timeline",
          checklistModalTitle: "Новый чек-лист",
          checklistNameLabel: "Название",
          checklistModeCheckbox: "Чекбоксы",
          checklistModePoll: "Опрос (варианты)",
          checklistOptionsPlaceholder: "Варианты, по одному в строке (для опроса)",
          createChecklist: "Создать",
          descEditTab: "Редактирование",
          descPreviewTab: "Просмотр",
          descMarkdownHint:
            "Markdown: **жирный**, списки, ссылки, `код`, таблицы, заголовки — хранится как текст.",
          descPreviewEmpty: "Пока нечего показывать.",
        };
  const [commentBody, setCommentBody] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const [checklistBusy, setChecklistBusy] = useState(false);
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkName, setLinkName] = useState("");
  const [checklistTitle, setChecklistTitle] = useState("");
  const [newChecklistItem, setNewChecklistItem] = useState<Record<string, string>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const [cardBusy, setCardBusy] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);
  const [fieldBusy, setFieldBusy] = useState(false);
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState(card.title || "");
  const [descriptionDraft, setDescriptionDraft] = useState(card.description || "");
  const [descriptionEditorTab, setDescriptionEditorTab] = useState<"edit" | "preview">("edit");
  const [estimateDraft, setEstimateDraft] = useState(card.estimate_points !== null ? String(card.estimate_points) : "");
  const [startDraft, setStartDraft] = useState(card.planned_start_at ? card.planned_start_at.slice(0, 10) : "");
  const [endDraft, setEndDraft] = useState(card.planned_end_at ? card.planned_end_at.slice(0, 10) : "");
  const [newFieldKey, setNewFieldKey] = useState("");
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldValue, setNewFieldValue] = useState("");
  const [priorityDraft, setPriorityDraft] = useState<"Терпит" | "Средний" | "Срочно" | "">("");
  const [tagsDraftList, setTagsDraftList] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [checklistModeDraft, setChecklistModeDraft] = useState<"checkbox" | "poll">("checkbox");
  const [checklistOptionsRaw, setChecklistOptionsRaw] = useState("");
  const [addActionsDialogOpen, setAddActionsDialogOpen] = useState(false);
  const [checklistModalOpen, setChecklistModalOpen] = useState(false);
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [blockReasonDraft, setBlockReasonDraft] = useState("");
  const [blockBusy, setBlockBusy] = useState(false);
  const [titleSaving, setTitleSaving] = useState(false);
  const [participantBusy, setParticipantBusy] = useState(false);
  const hiddenUploadInputRef = useRef<HTMLInputElement | null>(null);

  const assigneeField = useMemo(() => {
    return card.field_values.find((f) => f.key === "assignee_user_id");
  }, [card.field_values]);

  const assigneeId = typeof assigneeField?.value === "string" ? assigneeField.value : "";
  const participantsField = useMemo(
    () => card.field_values.find((f) => f.key === PARTICIPANT_FIELD_KEY),
    [card.field_values]
  );
  const blockedField = useMemo(() => card.field_values.find((f) => f.key === "blocked_count"), [card.field_values]);
  const currentBlocked = useMemo(() => {
    const v = blockedField?.value;
    if (typeof v === "number" && !Number.isNaN(v)) return Math.max(0, Math.floor(v));
    if (typeof v === "string") {
      const n = parseInt(v, 10);
      return Number.isNaN(n) ? 0 : Math.max(0, n);
    }
    return 0;
  }, [blockedField?.value]);

  const participantIdsForUi = useMemo(() => {
    const fromField = parseParticipantUserIds(participantsField?.value);
    if (fromField.length > 0) return fromField;
    return assigneeId ? [assigneeId] : [];
  }, [participantsField?.value, assigneeId]);

  const normalizedType = normalizeTaskCardType(card.card_type);

  const hiddenFieldKeys = useMemo(
    () =>
      new Set([
        PARTICIPANT_FIELD_KEY,
        "assignee_user_id",
        "assignee_name",
        "priority",
        "tags",
        "blocked_count",
        "blocking_count",
        "block_reason",
        "card_type",
      ]),
    []
  );

  const visibleCustomFields = useMemo(
    () =>
      card.field_values.filter(
        (fv) => !hiddenFieldKeys.has(fv.key) && !fv.key.startsWith("checklist_mode:")
      ),
    [card.field_values, hiddenFieldKeys]
  );

  const priorityField = useMemo(() => card.field_values.find((f) => f.key === "priority"), [card.field_values]);
  const tagsField = useMemo(() => card.field_values.find((f) => f.key === "tags"), [card.field_values]);

  useEffect(() => {
    setDescriptionEditorTab("edit");
    setTitleDraft(card.title || "");
    setDescriptionDraft(card.description || "");
    setEstimateDraft(card.estimate_points !== null ? String(card.estimate_points) : "");
    setStartDraft(card.planned_start_at ? card.planned_start_at.slice(0, 10) : "");
    setEndDraft(card.planned_end_at ? card.planned_end_at.slice(0, 10) : "");
    const p = typeof priorityField?.value === "string" ? priorityField.value : "";
    setPriorityDraft(p === "Терпит" || p === "Средний" || p === "Срочно" ? p : "");
    if (Array.isArray(tagsField?.value)) {
      setTagsDraftList((tagsField.value as unknown[]).map((x) => String(x)).filter(Boolean));
    } else if (typeof tagsField?.value === "string") {
      setTagsDraftList(
        tagsField.value
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
      );
    } else {
      setTagsDraftList([]);
    }
  }, [card, priorityField?.value, tagsField?.value]);

  const checklistModeMap = useMemo(() => {
    const map: Record<string, "checkbox" | "poll"> = {};
    for (const fv of card.field_values) {
      if (!fv.key.startsWith("checklist_mode:")) continue;
      const id = fv.key.slice("checklist_mode:".length);
      const val = typeof fv.value === "string" ? fv.value : "";
      map[id] = val === "poll" ? "poll" : "checkbox";
    }
    return map;
  }, [card.field_values]);

  async function handleFile(file: File) {
    if (!onUploadAttachment) return;
    if (!file) return;
    setUploadBusy(true);
    try {
      await onUploadAttachment(file);
    } catch (e: any) {
      setLocalNotice(e?.message ?? (locale === "en" ? "File upload failed" : "Не удалось загрузить файл"));
    } finally {
      setUploadBusy(false);
    }
  }

  async function submitComment() {
    if (!onAddComment) return;
    const trimmed = commentBody.trim();
    if (!trimmed) return;
    try {
      setCommentBusy(true);
      await onAddComment(trimmed);
      setCommentBody("");
    } finally {
      setCommentBusy(false);
    }
  }

  async function saveMainCard() {
    if (!onUpdateCard) return;
    setCardBusy(true);
    setLocalNotice(null);
    try {
      await onUpdateCard({
        title: titleDraft.trim(),
        description: descriptionDraft,
      });
    } catch (e: any) {
      setLocalNotice(e?.message ?? (locale === "en" ? "Save failed" : "Не удалось сохранить карточку"));
    } finally {
      setCardBusy(false);
    }
  }

  async function savePlanCard() {
    if (!onUpdateCard) return;
    setPlanBusy(true);
    setLocalNotice(null);
    try {
      await onUpdateCard({
        estimate_points: estimateDraft.trim() ? Number(estimateDraft.trim()) : null,
        planned_start_at: startDraft ? new Date(`${startDraft}T00:00:00`).toISOString() : null,
        planned_end_at: endDraft ? new Date(`${endDraft}T00:00:00`).toISOString() : null,
      });
      if (onUpsertFieldValue) {
        await onUpsertFieldValue({
          key: "priority",
          name: locale === "en" ? "Priority" : "Приоритет",
          value: priorityDraft || null,
          field_type: "text",
        });
        await onUpsertFieldValue({
          key: "tags",
          name: locale === "en" ? "Tags" : "Теги",
          value: tagsDraftList,
          field_type: "text",
        });
      }
    } catch (e: any) {
      setLocalNotice(e?.message ?? (locale === "en" ? "Plan save failed" : "Не удалось сохранить план"));
    } finally {
      setPlanBusy(false);
    }
  }

  const persistParticipants = useCallback(
    async (ids: string[]) => {
      if (!onUpsertFieldValue) return;
      setParticipantBusy(true);
      setLocalNotice(null);
      try {
        const unique = [...new Set(ids.filter(Boolean))];
        await onUpsertFieldValue({
          key: PARTICIPANT_FIELD_KEY,
          name: locale === "en" ? "Participants" : "Участники",
          value: unique,
          field_type: "text",
        });
        const firstId = unique[0] || "";
        const selected = firstId ? users.find((u) => u.id === firstId) : undefined;
        await onUpsertFieldValue({
          key: "assignee_user_id",
          name: locale === "en" ? "Assignee" : "Ответственный",
          value: firstId || null,
          field_type: "text",
        });
        await onUpsertFieldValue({
          key: "assignee_name",
          name: locale === "en" ? "Assignee name" : "Имя ответственного",
          value: selected ? selected.full_name || selected.email : null,
          field_type: "text",
        });
      } catch (e: any) {
        setLocalNotice(
          e?.message ?? (locale === "en" ? "Failed to update participants" : "Не удалось обновить участников")
        );
      } finally {
        setParticipantBusy(false);
      }
    },
    [onUpsertFieldValue, users, locale]
  );

  const addParticipantUser = useCallback(
    async (userId: string) => {
      if (!userId || !onUpsertFieldValue) return;
      const fromField = parseParticipantUserIds(participantsField?.value);
      const base = fromField.length > 0 ? fromField : assigneeId ? [assigneeId] : [];
      if (base.includes(userId)) return;
      await persistParticipants([...base, userId]);
    },
    [participantsField?.value, assigneeId, onUpsertFieldValue, persistParticipants]
  );

  const removeParticipantUser = useCallback(
    async (userId: string) => {
      const fromField = parseParticipantUserIds(participantsField?.value);
      const base = fromField.length > 0 ? fromField : assigneeId ? [assigneeId] : [];
      await persistParticipants(base.filter((id) => id !== userId));
    },
    [participantsField?.value, assigneeId, persistParticipants]
  );

  const saveTitleIfChanged = useCallback(async () => {
    if (!onUpdateCard) return;
    const next = titleDraft.trim();
    if (!next) {
      setTitleDraft(card.title || "");
      setLocalNotice(locale === "en" ? "Title cannot be empty" : "Название не может быть пустым");
      return;
    }
    if (next === (card.title || "").trim()) return;
    setTitleSaving(true);
    setLocalNotice(null);
    try {
      await onUpdateCard({ title: next });
    } catch (e: any) {
      setLocalNotice(e?.message ?? (locale === "en" ? "Could not save title" : "Не удалось сохранить название"));
    } finally {
      setTitleSaving(false);
    }
  }, [onUpdateCard, titleDraft, card.title, locale]);

  const applyCardType = useCallback(
    async (next: TaskCardTypeId) => {
      if (!onUpdateCard) return;
      setLocalNotice(null);
      try {
        await onUpdateCard({ card_type: next });
      } catch (e: any) {
        setLocalNotice(e?.message ?? (locale === "en" ? "Could not update type" : "Не удалось сменить тип"));
      }
    },
    [onUpdateCard]
  );

  const createChecklistFromModal = useCallback(async () => {
    if (!onAddChecklist || !checklistTitle.trim()) return;
    setChecklistBusy(true);
    setLocalNotice(null);
    try {
      const created = await onAddChecklist(checklistTitle.trim());
      const createdId = created && typeof created === "object" && "id" in created ? created.id : null;
      if (createdId && onUpsertFieldValue) {
        await onUpsertFieldValue({
          key: `checklist_mode:${createdId}`,
          name: locale === "en" ? "Checklist mode" : "Тип чек-листа",
          value: checklistModeDraft,
          field_type: "text",
        });
      }
      const options = checklistOptionsRaw
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean);
      if (createdId && onAddChecklistItem && options.length) {
        for (const opt of options) {
          await onAddChecklistItem(createdId, opt);
        }
      }
      setChecklistModalOpen(false);
      setChecklistTitle("");
      setChecklistOptionsRaw("");
      setLocalNotice(locale === "en" ? "Checklist created." : "Чек-лист создан.");
    } catch (e: any) {
      setLocalNotice(e?.message ?? (locale === "en" ? "Could not create checklist" : "Не удалось создать чек-лист"));
    } finally {
      setChecklistBusy(false);
    }
  }, [
    onAddChecklist,
    checklistTitle,
    onUpsertFieldValue,
    checklistModeDraft,
    checklistOptionsRaw,
    onAddChecklistItem,
    locale,
  ]);

  const submitBlockCard = useCallback(async () => {
    const reason = blockReasonDraft.trim();
    if (!reason || !onUpsertFieldValue) return;
    setBlockBusy(true);
    setLocalNotice(null);
    try {
      await onUpsertFieldValue({
        key: "block_reason",
        name: locale === "en" ? "Block reason" : "Причина блокировки",
        value: reason,
        field_type: "text",
      });
      await onUpsertFieldValue({
        key: "blocked_count",
        name: locale === "en" ? "Block count" : "Количество блокировок",
        value: currentBlocked + 1,
        field_type: "number",
      });
      setBlockDialogOpen(false);
      setBlockReasonDraft("");
    } catch (e: any) {
      setLocalNotice(e?.message ?? (locale === "en" ? "Could not block card" : "Не удалось заблокировать"));
    } finally {
      setBlockBusy(false);
    }
  }, [blockReasonDraft, onUpsertFieldValue, currentBlocked, locale]);

  async function handleMenuAction(action: string) {
    setMenuOpen(false);
    try {
      if (action === "copy-id") {
        await navigator.clipboard.writeText(card.id);
      } else if (action === "copy-id-title") {
        await navigator.clipboard.writeText(`${card.id} ${card.title}`);
      } else if (action === "copy-markdown") {
        await navigator.clipboard.writeText(`[${card.title}](card:${card.id})`);
      } else if (action === "history") {
        setLocalNotice(
          `${locale === "en" ? "Comments" : "Комментарии"}: ${card.comments.length}, ${locale === "en" ? "Attachments" : "Вложения"}: ${card.attachments.length}`
        );
      } else if (action === "move") {
        if (!onUpdateCard || !availableColumns.length) return;
        const names = availableColumns.map((c, idx) => `${idx + 1}. ${c.name}`).join("\n");
        const val = window.prompt(`${locale === "en" ? "Move to column" : "Переместить в колонку"}\n${names}`, "1");
        const idx = Number(val || "0") - 1;
        if (idx >= 0 && idx < availableColumns.length) {
          await onUpdateCard({ column_id: availableColumns[idx].id });
        }
      } else if (action === "time-track") {
        const val = window.prompt(locale === "en" ? "Spent minutes" : "Потрачено минут", "30");
        if (val && onUpsertFieldValue) {
          await onUpsertFieldValue({
            key: "time_spent_minutes",
            name: locale === "en" ? "Time spent (min)" : "Потрачено времени (мин)",
            value: Number(val),
            field_type: "number",
          });
        }
      } else if (action === "subscribe") {
        await onUpsertFieldValue?.({
          key: "subscribed",
          name: locale === "en" ? "Subscribed" : "Подписка",
          value: true,
          field_type: "boolean",
        });
      } else if (action === "block") {
        setBlockReasonDraft("");
        setBlockDialogOpen(true);
      } else if (action === "share") {
        await onUpsertFieldValue?.({
          key: "blocking_count",
          name: locale === "en" ? "Blocking cards count" : "Количество блокируемых карточек",
          value: 1,
          field_type: "number",
        });
      } else if (action === "link-service") {
        const serviceUrl = window.prompt("URL", "https://");
        if (serviceUrl && onAddAttachmentUrl) {
          await onAddAttachmentUrl({
            file_url: serviceUrl,
            file_name: locale === "en" ? "Service link" : "Ссылка на сервис",
          });
        }
      } else if (action === "print") {
        window.print();
      } else if (action === "email-comments") {
        const body = card.comments.map((c) => `- ${c.author_full_name || c.author_email}: ${c.body}`).join("\n");
        window.location.href = `mailto:?subject=${encodeURIComponent(card.title)}&body=${encodeURIComponent(body || card.title)}`;
      } else if (action === "archive") {
        const doneCol = availableColumns.find((c) => c.is_done);
        if (doneCol && onUpdateCard) await onUpdateCard({ column_id: doneCol.id });
      } else if (action === "delete") {
        if (!onDeleteCard) return;
        const confirmed = window.confirm(locale === "en" ? "Delete card?" : "Удалить карточку?");
        if (!confirmed) return;
        await onDeleteCard();
      }
    } catch (e: any) {
      setLocalNotice(e?.message ?? (locale === "en" ? "Action failed" : "Не удалось выполнить действие"));
    }
  }

  async function handleAddMenuAction(action: string) {
    try {
      if (action === "due") {
        const value = window.prompt(locale === "en" ? "End date YYYY-MM-DD" : "Дата окончания YYYY-MM-DD", endDraft || "");
        if (value !== null) {
          const next = value.trim();
          setEndDraft(next);
          if (onUpdateCard) {
            await onUpdateCard({
              planned_end_at: next ? new Date(`${next}T00:00:00`).toISOString() : null,
            });
          }
        }
      } else if (action === "tags") {
        const value = window.prompt(
          locale === "en" ? "Tags (comma separated)" : "Теги через запятую",
          tagsDraftList.join(", ")
        );
        if (value !== null) {
          const tags = value
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean);
          setTagsDraftList(tags);
          if (onUpsertFieldValue) {
            await onUpsertFieldValue({
              key: "tags",
              name: locale === "en" ? "Tags" : "Теги",
              value: tags,
              field_type: "text",
            });
          }
        }
      } else if (action === "checklist") {
        setAddActionsDialogOpen(false);
        setChecklistModalOpen(true);
        return;
      } else if (action === "link") {
        setShowLinkForm(true);
      } else if (action === "file") {
        hiddenUploadInputRef.current?.click();
      } else if (action === "parent") {
        const value = window.prompt(locale === "en" ? "Parent card id" : "ID родительской карточки", "");
        if (value && onUpsertFieldValue) {
          await onUpsertFieldValue({ key: "parent_card_id", name: locale === "en" ? "Parent card" : "Родительская карточка", value: value.trim(), field_type: "text" });
        }
      } else if (action === "child") {
        await onUpsertFieldValue?.({
          key: "parent_card_id_for_new_child",
          name: locale === "en" ? "Parent for new child" : "Родитель для новой дочерней",
          value: card.id,
          field_type: "text",
        });
        onCreateRelatedCard?.();
        setLocalNotice(locale === "en" ? "Child card creation opened" : "Открыто создание дочерней карточки");
      } else if (action === "acceptance") {
        if (!onAddChecklist) return;
        await onAddChecklist(locale === "en" ? "Acceptance criteria" : "Критерии приёмки");
      } else if (action === "gdrive") {
        const value = window.prompt("Google Drive URL", "https://drive.google.com/");
        if (value && onAddAttachmentUrl) await onAddAttachmentUrl({ file_url: value, file_name: "Google Drive" });
      } else if (action === "dropbox") {
        const value = window.prompt("Dropbox URL", "https://www.dropbox.com/");
        if (value && onAddAttachmentUrl) await onAddAttachmentUrl({ file_url: value, file_name: "Dropbox" });
      } else if (action === "new-field") {
        if (!onUpsertFieldValue) return;
        const key = window.prompt(locale === "en" ? "Field key" : "Ключ поля", "");
        if (!key || !key.trim()) return;
        const name = window.prompt(locale === "en" ? "Field name" : "Название поля", key.trim()) || key.trim();
        const value = window.prompt(locale === "en" ? "Field value" : "Значение поля", "") || "";
        await onUpsertFieldValue({
          key: key.trim(),
          name: name.trim(),
          value,
          field_type: "text",
        });
      } else if (action === "time-spent") {
        const value = window.prompt(locale === "en" ? "Minutes spent" : "Потрачено минут", "");
        if (value && onUpsertFieldValue) {
          await onUpsertFieldValue({ key: "time_spent_minutes", name: locale === "en" ? "Time spent" : "Трудозатраты", value: Number(value), field_type: "number" });
        }
      } else if (action === "size") {
        const value = window.prompt(locale === "en" ? "Size" : "Размер", "");
        if (value && onUpsertFieldValue) {
          await onUpsertFieldValue({ key: "size", name: locale === "en" ? "Size" : "Размер", value: value, field_type: "text" });
        }
      } else if (action === "timeline") {
        const value = window.prompt(locale === "en" ? "Timeline info" : "Данные timeline", "");
        if (value && onUpsertFieldValue) {
          await onUpsertFieldValue({ key: "timeline", name: "Timeline", value, field_type: "text" });
        }
      }
      setLocalNotice(locale === "en" ? "Done" : "Готово");
    } catch (e: any) {
      setLocalNotice(e?.message ?? (locale === "en" ? "Action failed" : "Не удалось выполнить действие"));
    } finally {
      setAddActionsDialogOpen(false);
    }
  }

  const toolbarIconButtonClass =
    "w-12 h-12 rounded-full border border-[var(--k-border)] flex items-center justify-center bg-[var(--k-surface-bg)] hover:bg-[var(--k-page-bg)] transition-colors text-[var(--k-text)]";

  const addMenuRowClass =
    "w-full text-left rounded-xl px-3 py-2.5 text-sm text-[var(--k-text)] border border-transparent hover:bg-[var(--k-page-bg)] hover:border-[var(--k-border)] transition-colors";

  const dialogPaperSx = {
    bgcolor: "var(--k-surface-bg)",
    color: "var(--k-text)",
    border: "1px solid var(--k-border)",
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/45 p-4 md:p-6"
      role="dialog"
      aria-modal="true"
      onClick={() => {
        setMenuOpen(false);
        setAddActionsDialogOpen(false);
        setChecklistModalOpen(false);
      }}
    >
      <div
        className="w-full max-w-[1260px] h-[min(94vh,860px)] overflow-hidden rounded-3xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] shadow-2xl flex flex-col relative mt-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-8 py-6 border-b border-[var(--k-border)] flex items-start justify-between gap-4 bg-[var(--k-surface-bg)]">
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-2">
                <input
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={() => void saveTitleIfChanged()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  disabled={!onUpdateCard}
                  className="w-full bg-transparent text-[var(--k-text)] text-[30px] leading-tight font-extrabold tracking-tight outline-none border-b border-transparent focus:border-[var(--k-border)] pb-1 disabled:opacity-60"
                  placeholder={locale === "en" ? "Task title" : "Название задачи"}
                />
                {titleSaving ? (
                  <CircularProgress size={22} sx={{ color: "#9C27B0", mt: 1, flexShrink: 0 }} />
                ) : null}
              </div>
              <div className="text-[var(--k-text-muted)] text-xs mt-1">
                {locale === "en" ? "Blur field or Enter to save title." : "Сохранение названия: уход с поля или Enter."}
              </div>
              <div className="text-[var(--k-text-muted)] text-sm mt-0.5">
                #{card.id.slice(0, 8)} · {t.created}{" "}
                {card.created_at ? new Date(card.created_at).toLocaleString(locale === "en" ? "en-US" : "ru-RU") : t.justNow}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {onToggleFavorite ? (
                <button
                  type="button"
                  data-testid="favorite-card-button"
                  aria-label={isFavorite ? "Убрать из избранного" : "Добавить в избранное"}
                  onClick={onToggleFavorite}
                  className="w-12 h-12 rounded-full border border-[var(--k-border)] flex items-center justify-center bg-[var(--k-surface-bg)] hover:bg-[var(--k-page-bg)] transition-colors"
                >
                  {isFavorite ? <StarIcon className="text-[#FBC02D]" /> : <StarBorderIcon className="text-[var(--k-text-muted)]" />}
                </button>
              ) : null}
              {onAddChecklist || onUploadAttachment || onAddAttachmentUrl || onUpsertFieldValue ? (
                <button
                  type="button"
                  data-testid="add-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAddActionsDialogOpen(true);
                  }}
                  className="w-12 h-12 rounded-full border border-transparent flex items-center justify-center bg-gradient-to-r from-[#8A2BE2] to-[#4B0082] text-white hover:opacity-90 transition-opacity"
                  aria-label={t.addToCard}
                >
                  <AddIcon fontSize="medium" />
                </button>
              ) : null}
              <button
                type="button"
                data-testid="card-three-dots-menu"
                aria-label={locale === "en" ? "Menu" : "Меню"}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((v) => !v);
                }}
                className={toolbarIconButtonClass}
              >
                <MoreVertIcon className="text-[var(--k-text-muted)]" />
              </button>
              <button
                onClick={onClose}
                className={toolbarIconButtonClass}
                aria-label={t.close}
              >
                X
              </button>
            </div>
        </div>
        {menuOpen ? (
          <div className="absolute right-6 top-[72px] z-[140] w-[min(320px,calc(100vw-2rem))] max-h-[min(70vh,520px)] overflow-y-auto rounded-xl border border-[var(--k-border)] bg-[var(--k-page-bg)] shadow-2xl">
            <div className="p-1.5">
              <button type="button" onClick={() => handleMenuAction("copy-id")} className="w-full text-left rounded-lg px-3 py-2 hover:bg-[var(--k-surface-bg)]">Скопировать id карточки</button>
              <button type="button" onClick={() => handleMenuAction("copy-id-title")} className="w-full text-left rounded-lg px-3 py-2 hover:bg-[var(--k-surface-bg)]">Скопировать id и название карточки</button>
              <button type="button" onClick={() => handleMenuAction("copy-markdown")} className="w-full text-left rounded-lg px-3 py-2 hover:bg-[var(--k-surface-bg)]">Скопировать markdown ссылку</button>
              <div className="my-1 h-px bg-[var(--k-border)]" />
              <button type="button" onClick={() => handleMenuAction("time-track")} className="w-full text-left rounded-lg px-3 py-2 hover:bg-[var(--k-surface-bg)]">Учёт времени</button>
              <button type="button" onClick={() => handleMenuAction("history")} className="w-full text-left rounded-lg px-3 py-2 hover:bg-[var(--k-surface-bg)]">Показать историю</button>
              <div className="my-1 h-px bg-[var(--k-border)]" />
              <button type="button" onClick={() => handleMenuAction("move")} className="w-full text-left rounded-lg px-3 py-2 hover:bg-[var(--k-surface-bg)]">Переместить...</button>
              <button type="button" onClick={() => handleMenuAction("subscribe")} className="w-full text-left rounded-lg px-3 py-2 hover:bg-[var(--k-surface-bg)]">Подписаться</button>
              <button type="button" onClick={() => handleMenuAction("block")} className="w-full text-left rounded-lg px-3 py-2 hover:bg-[var(--k-surface-bg)]">Заблокировать карточку</button>
              <button type="button" onClick={() => handleMenuAction("share")} className="w-full text-left rounded-lg px-3 py-2 hover:bg-[var(--k-surface-bg)]">Поделиться</button>
              <button type="button" onClick={() => handleMenuAction("link-service")} className="w-full text-left rounded-lg px-3 py-2 hover:bg-[var(--k-surface-bg)]">Привязать к сервису</button>
              <div className="my-1 h-px bg-[var(--k-border)]" />
              <button type="button" onClick={() => handleMenuAction("print")} className="w-full text-left rounded-lg px-3 py-2 hover:bg-[var(--k-surface-bg)]">Экспорт в PDF / Печать</button>
              <button type="button" onClick={() => handleMenuAction("email-comments")} className="w-full text-left rounded-lg px-3 py-2 hover:bg-[var(--k-surface-bg)]">Email комментарии</button>
              <button type="button" onClick={() => handleMenuAction("archive")} className="w-full text-left rounded-lg px-3 py-2 hover:bg-[var(--k-surface-bg)]">Переместить в архив</button>
              <button type="button" onClick={() => handleMenuAction("delete")} className="w-full text-left rounded-lg px-3 py-2 text-red-500 hover:bg-[var(--k-surface-bg)]">{t.delete}</button>
            </div>
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto overscroll-contain px-8 py-6 bg-[var(--k-page-bg)]">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_420px] gap-5 items-start">
            <div className="space-y-4 min-w-0">

          <div className="rounded-2xl border border-[var(--k-border)] bg-[var(--k-page-bg)] p-4 space-y-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--k-text-muted)] mb-1">{t.location}</div>
              <div className="text-[var(--k-text)] text-sm">
                {(card.space_name || "—") + " / " + (card.board_name || "—")}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--k-text-muted)] mb-1">{t.column}</div>
              <select
                value={card.column_id}
                disabled={!onUpdateCard}
                onChange={async (e) => {
                  if (!onUpdateCard) return;
                  try {
                    await onUpdateCard({ column_id: e.target.value });
                  } catch (err: any) {
                    setLocalNotice(err?.message ?? (locale === "en" ? "Could not change column" : "Не удалось сменить колонку"));
                  }
                }}
                className="w-full rounded-xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] px-3 py-2.5 text-[var(--k-text)] text-sm"
              >
                {availableColumns.length
                  ? availableColumns.map((col) => (
                      <option key={col.id} value={col.id}>
                        {col.is_done ? `${col.name} (${t.done})` : col.name}
                      </option>
                    ))
                  : (
                    <option value={card.column_id}>{card.column_is_done ? t.done : card.column_name || "—"}</option>
                  )}
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-[var(--k-text-muted)] mb-1">{t.type}</div>
                <div className="flex items-center gap-2">
                  <TaskTypeIcon type={normalizedType} size={26} />
                  <select
                    value={normalizedType}
                    disabled={!onUpdateCard}
                    onChange={(e) => void applyCardType(e.target.value as TaskCardTypeId)}
                    className="flex-1 min-w-0 rounded-xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] px-3 py-2 text-[var(--k-text)] text-sm"
                  >
                    <option value="task">{t.typeCard}</option>
                    <option value="bug">{t.typeBug}</option>
                    <option value="feature">{t.typeFeature}</option>
                  </select>
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-[var(--k-text-muted)] mb-1">{t.participants}</div>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, alignItems: "center", minHeight: 40 }}>
                  {participantIdsForUi.length === 0 ? (
                    <Typography variant="body2" sx={{ color: "var(--k-text-muted)", fontSize: 13 }}>
                      {locale === "en" ? "No participants" : "Нет участников"}
                    </Typography>
                  ) : (
                    participantIdsForUi.map((uid) => {
                      const u = users.find((x) => x.id === uid);
                      const label = u?.full_name || u?.email || uid.slice(0, 8);
                      return (
                        <Chip
                          key={uid}
                          label={label}
                          onDelete={onUpsertFieldValue ? () => void removeParticipantUser(uid) : undefined}
                          disabled={participantBusy}
                          size="small"
                          sx={{
                            bgcolor: "rgba(156,39,176,0.12)",
                            color: "var(--k-text)",
                            "& .MuiChip-deleteIcon": { color: "var(--k-text-muted)" },
                          }}
                        />
                      );
                    })
                  )}
                </Box>
                {onUpsertFieldValue ? (
                  <select
                    value=""
                    disabled={participantBusy || users.length === 0}
                    onChange={(e) => {
                      const v = e.target.value;
                      e.target.value = "";
                      if (v) void addParticipantUser(v);
                    }}
                    className="mt-2 w-full px-3 py-1.5 rounded-xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] text-[var(--k-text)] text-xs"
                  >
                    <option value="">{t.addParticipant}</option>
                    {users
                      .filter((u) => !participantIdsForUi.includes(u.id))
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.full_name || u.email}
                        </option>
                      ))}
                  </select>
                ) : null}
              </div>
            </div>
            <div data-testid="description-section">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <div className="text-xs font-semibold uppercase tracking-wider text-[var(--k-text-muted)]">{t.description}</div>
                <div className="flex rounded-lg border border-[var(--k-border)] bg-[var(--k-page-bg)] p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setDescriptionEditorTab("edit")}
                    className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                      descriptionEditorTab === "edit"
                        ? "bg-[var(--k-surface-bg)] text-[var(--k-text)] shadow-sm"
                        : "text-[var(--k-text-muted)] hover:text-[var(--k-text)]"
                    }`}
                  >
                    {t.descEditTab}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDescriptionEditorTab("preview")}
                    className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                      descriptionEditorTab === "preview"
                        ? "bg-[var(--k-surface-bg)] text-[var(--k-text)] shadow-sm"
                        : "text-[var(--k-text-muted)] hover:text-[var(--k-text)]"
                    }`}
                  >
                    {t.descPreviewTab}
                  </button>
                </div>
              </div>
              {descriptionEditorTab === "edit" ? (
                <textarea
                  value={descriptionDraft}
                  onChange={(e) => setDescriptionDraft(e.target.value)}
                  rows={6}
                  spellCheck
                  placeholder={locale === "en" ? "Write in Markdown…" : "Текст в формате Markdown…"}
                  className="w-full rounded-xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] p-3 text-[var(--k-text)] text-sm resize-y font-mono leading-relaxed"
                />
              ) : (
                <div className="min-h-[152px] max-h-[min(50vh,420px)] overflow-y-auto rounded-xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] p-3">
                  <MarkdownDescriptionPreview source={descriptionDraft} emptyLabel={t.descPreviewEmpty} />
                </div>
              )}
              <p className="mt-1 text-[10px] leading-snug text-[var(--k-text-muted)]">{t.descMarkdownHint}</p>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  disabled={cardBusy}
                  onClick={saveMainCard}
                  className="px-4 py-2 rounded-full bg-gradient-to-r from-[#8A2BE2] to-[#4B0082] text-white text-sm font-semibold disabled:opacity-60"
                >
                  {cardBusy ? t.adding : t.save}
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-[var(--k-border)] bg-[var(--k-page-bg)] p-4 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--k-text-muted)]">{t.plan}</div>
            <div className="mt-2 text-[var(--k-text)] text-sm space-y-2">
              <div className="grid grid-cols-[120px_1fr] items-center gap-2">
                <div className="text-[var(--k-text-muted)]">{t.estimate}</div>
                <input
                  value={estimateDraft}
                  onChange={(e) => setEstimateDraft(e.target.value)}
                  className="rounded-xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] px-3 py-2 text-sm text-[var(--k-text)]"
                  placeholder="0"
                />
              </div>
              <div className="grid grid-cols-[120px_1fr] items-center gap-2">
                <div className="text-[var(--k-text-muted)]">{t.start}</div>
                <input
                  type="date"
                  value={startDraft}
                  onChange={(e) => setStartDraft(e.target.value)}
                  className="rounded-xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] px-3 py-2 text-sm text-[var(--k-text)]"
                />
              </div>
              <div className="grid grid-cols-[120px_1fr] items-center gap-2">
                <div className="text-[var(--k-text-muted)]">{t.end}</div>
                <input
                  type="date"
                  value={endDraft}
                  onChange={(e) => setEndDraft(e.target.value)}
                  className="rounded-xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] px-3 py-2 text-sm text-[var(--k-text)]"
                />
              </div>
              <div className="grid grid-cols-[120px_1fr] items-center gap-2">
                <div className="text-[var(--k-text-muted)]">{locale === "en" ? "Priority" : "Приоритет"}</div>
                <select
                  value={priorityDraft}
                  onChange={(e) => setPriorityDraft((e.target.value as "Терпит" | "Средний" | "Срочно" | "") || "")}
                  className="rounded-xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] px-3 py-2 text-sm text-[var(--k-text)]"
                >
                  <option value="">{locale === "en" ? "Not set" : "Не задан"}</option>
                  <option value="Терпит">Терпит</option>
                  <option value="Средний">Средний</option>
                  <option value="Срочно">Срочно</option>
                </select>
              </div>
              <div className="grid grid-cols-[120px_1fr] items-center gap-2">
                <div className="text-[var(--k-text-muted)]">{locale === "en" ? "Tags" : "Теги"}</div>
                <div>
                  <div className="flex flex-wrap gap-1 mb-1">
                    {tagsDraftList.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => setTagsDraftList((prev) => prev.filter((x) => x !== tag))}
                        className="px-2 py-0.5 text-xs border border-[var(--k-border)] bg-[var(--k-surface-bg)]"
                        title={locale === "en" ? "Remove tag" : "Удалить метку"}
                      >
                        {tag} ×
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-1">
                    <input
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      className="rounded-xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] px-3 py-2 text-sm text-[var(--k-text)] flex-1"
                      placeholder={locale === "en" ? "New tag" : "Новая метка"}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const val = tagInput.trim();
                        if (!val) return;
                        setTagsDraftList((prev) => (prev.includes(val) ? prev : [...prev, val]));
                        setTagInput("");
                      }}
                      className="px-3 py-2 rounded-xl border border-[var(--k-border)] text-sm hover:bg-[var(--k-page-bg)]"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
              <div className="pt-1 flex justify-end">
                <button
                  type="button"
                  disabled={planBusy}
                  onClick={savePlanCard}
                  className="px-4 py-2 rounded-full border border-[var(--k-border)] hover:bg-[var(--k-surface-bg)] disabled:opacity-60"
                >
                  {planBusy ? t.adding : t.save}
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--k-border)] bg-[var(--k-page-bg)] p-4 space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--k-text-muted)]">{t.checklists}</div>
              {onAddChecklist ? (
                <button
                  type="button"
                  onClick={() => setChecklistModalOpen(true)}
                  className="shrink-0 px-4 py-2 rounded-full text-sm font-semibold bg-gradient-to-r from-[#8A2BE2] to-[#4B0082] text-white hover:opacity-90 transition-opacity"
                >
                  {locale === "en" ? "Add checklist" : "Добавить чек-лист"}
                </button>
              ) : null}
            </div>
            <div className="mt-2 space-y-3">
              {card.checklists.length ? (
                card.checklists.map((cl) => (
                  <div key={cl.id}>
                    <div className="text-[var(--k-text)] text-sm font-semibold">{cl.title}</div>
                    <div className="mt-2 space-y-2">
                      {cl.items.map((it) => (
                        <div key={it.id} className="text-[var(--k-text-muted)] text-sm flex items-center gap-2">
                          {checklistModeMap[cl.id] === "poll" ? (
                            <input
                              type="radio"
                              name={`poll-${cl.id}`}
                              checked={it.is_done}
                              onChange={async () => {
                                if (!onToggleChecklistItem) return;
                                for (const item of cl.items) {
                                  await onToggleChecklistItem(item.id, item.id === it.id);
                                }
                              }}
                            />
                          ) : (
                            <input
                              type="checkbox"
                              checked={it.is_done}
                              onChange={async (e) => {
                                if (!onToggleChecklistItem) return;
                                await onToggleChecklistItem(it.id, e.target.checked);
                              }}
                            />
                          )}
                          <span className={it.is_done ? "line-through" : ""}>{it.title}</span>
                        </div>
                      ))}
                    </div>
                    {onAddChecklistItem ? (
                      <div className="mt-2 flex gap-2">
                        <input
                          value={newChecklistItem[cl.id] || ""}
                          onChange={(e) => setNewChecklistItem((prev) => ({ ...prev, [cl.id]: e.target.value }))}
                          placeholder={t.addItem}
                          className="flex-1 rounded-xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] px-3 py-2 text-[var(--k-text)] outline-none text-sm"
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            const title = (newChecklistItem[cl.id] || "").trim();
                            if (!title) return;
                            await onAddChecklistItem(cl.id, title);
                            setNewChecklistItem((prev) => ({ ...prev, [cl.id]: "" }));
                          }}
                          className="rounded-xl px-3 py-2 border border-[var(--k-border)] text-xs hover:bg-[var(--k-surface-bg)]"
                        >
                          {t.add}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="text-[var(--k-text-muted)] text-sm">{t.noChecklists}</div>
              )}
            </div>
          </div>
          </div>

          <div className="rounded-2xl border border-[var(--k-border)] bg-[var(--k-page-bg)] p-4 space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--k-text-muted)]">{t.fields}</div>
        <div className="space-y-2">
          {visibleCustomFields.length ? (
            visibleCustomFields.map((fv) => (
              <div key={fv.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="text-[var(--k-text)] text-sm font-medium shrink-0">{fv.name}</div>
                <input
                  defaultValue={
                    typeof fv.value === "string" ? fv.value : fv.value === null ? "" : JSON.stringify(fv.value)
                  }
                  onBlur={async (e) => {
                    if (!onUpsertFieldValue) return;
                    try {
                      await onUpsertFieldValue({
                        key: fv.key,
                        name: fv.name,
                        value: e.target.value,
                        field_type: "text",
                      });
                    } catch (err: any) {
                      setLocalNotice(err?.message ?? "Не удалось обновить поле");
                    }
                  }}
                  className="text-[var(--k-text)] text-sm w-full sm:w-[58%] bg-[var(--k-surface-bg)] border border-[var(--k-border)] rounded-xl px-3 py-2"
                />
              </div>
            ))
          ) : (
            <div className="text-[var(--k-text-muted)] text-sm">{t.noFields}</div>
          )}
        </div>
        {onUpsertFieldValue ? (
          <div className="rounded-xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] p-3 grid grid-cols-1 md:grid-cols-3 gap-2">
            <input
              value={newFieldKey}
              onChange={(e) => setNewFieldKey(e.target.value)}
              placeholder={locale === "en" ? "Field key" : "Ключ поля"}
              className="rounded-xl border border-[var(--k-border)] bg-[var(--k-page-bg)] px-3 py-2 text-sm text-[var(--k-text)]"
            />
            <input
              value={newFieldName}
              onChange={(e) => setNewFieldName(e.target.value)}
              placeholder={locale === "en" ? "Field name" : "Название поля"}
              className="rounded-xl border border-[var(--k-border)] bg-[var(--k-page-bg)] px-3 py-2 text-sm text-[var(--k-text)]"
            />
            <input
              value={newFieldValue}
              onChange={(e) => setNewFieldValue(e.target.value)}
              placeholder={locale === "en" ? "Value" : "Значение"}
              className="rounded-xl border border-[var(--k-border)] bg-[var(--k-page-bg)] px-3 py-2 text-sm text-[var(--k-text)]"
            />
            <div className="md:col-span-3 flex justify-end">
              <button
                type="button"
                disabled={!newFieldKey.trim() || fieldBusy}
                onClick={async () => {
                  if (!onUpsertFieldValue || !newFieldKey.trim()) return;
                  setFieldBusy(true);
                  try {
                    await onUpsertFieldValue({
                      key: newFieldKey.trim(),
                      name: newFieldName.trim() || newFieldKey.trim(),
                      value: newFieldValue,
                      field_type: "text",
                    });
                    setNewFieldKey("");
                    setNewFieldName("");
                    setNewFieldValue("");
                  } catch (e: any) {
                    setLocalNotice(e?.message ?? "Не удалось добавить поле");
                  } finally {
                    setFieldBusy(false);
                  }
                }}
                className="px-4 py-2 rounded-full border border-[var(--k-border)] hover:bg-[var(--k-page-bg)] disabled:opacity-60 text-sm font-semibold"
              >
                {fieldBusy ? t.adding : t.add}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-[var(--k-border)] bg-[var(--k-page-bg)] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--k-text-muted)]">{t.attachmentsLinks}</div>
          <div className="text-[var(--k-text-muted)] text-xs">
            {card.attachments.length} {locale === "en" ? "items" : "шт."}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {onUploadAttachment ? (
            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
              <input
                type="file"
                ref={hiddenUploadInputRef}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                  e.currentTarget.value = "";
                }}
                disabled={uploadBusy}
              />
              <span className="rounded-full px-4 py-2 text-[var(--k-text)] text-sm font-semibold bg-[var(--k-surface-bg)] border border-[var(--k-border)] hover:bg-[var(--k-page-bg)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
                {uploadBusy ? "..." : t.upload}
              </span>
            </label>
          ) : null}
          {onAddAttachmentUrl ? (
            <button
              type="button"
              onClick={() => setShowLinkForm((v) => !v)}
              disabled={linkBusy}
              className="rounded-full px-4 py-2 text-[var(--k-text)] text-sm font-semibold bg-[var(--k-surface-bg)] border border-[var(--k-border)] hover:bg-[var(--k-page-bg)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {t.link}
            </button>
          ) : null}
        </div>

        {showLinkForm && onAddAttachmentUrl ? (
          <div className="rounded-xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] p-3 space-y-2">
            <div className="text-[var(--k-text-muted)] text-xs">{t.addByUrl}</div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://..." className="flex-1 rounded-xl border border-[var(--k-border)] bg-[var(--k-page-bg)] px-3 py-2 text-sm text-[var(--k-text)] outline-none focus:border-[#8A2BE2]" />
              <input value={linkName} onChange={(e) => setLinkName(e.target.value)} placeholder={t.fileNameOptional} className="flex-1 rounded-xl border border-[var(--k-border)] bg-[var(--k-page-bg)] px-3 py-2 text-sm text-[var(--k-text)] outline-none focus:border-[#8A2BE2]" />
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={() => { setShowLinkForm(false); setLinkUrl(""); setLinkName(""); }} disabled={linkBusy} className="px-4 py-2 rounded-full border border-[var(--k-border)] text-[var(--k-text)] text-sm font-semibold hover:bg-[var(--k-page-bg)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
                {t.cancel}
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!onAddAttachmentUrl || !linkUrl.trim()) return;
                  setLinkBusy(true);
                  try {
                    await onAddAttachmentUrl({ file_url: linkUrl.trim(), file_name: linkName.trim() || undefined });
                    setShowLinkForm(false);
                    setLinkUrl("");
                    setLinkName("");
                  } finally {
                    setLinkBusy(false);
                  }
                }}
                disabled={!linkUrl.trim() || linkBusy}
                className="px-6 py-2 rounded-full bg-gradient-to-r from-[#8A2BE2] to-[#4B0082] text-white text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {linkBusy ? t.adding : t.add}
              </button>
            </div>
          </div>
        ) : null}

        <div className="space-y-2">
          {card.attachments.length ? (
            card.attachments.map((a) => (
              <div key={a.id} className="rounded-xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] px-3 py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[var(--k-text)] text-sm truncate font-semibold">{a.file_name}</div>
                  {a.size_bytes !== null && a.size_bytes !== undefined ? <div className="text-[var(--k-text-muted)] text-xs mt-0.5">{a.size_bytes} байт</div> : null}
                </div>
                {a.file_url ? (
                  <a href={a.file_url} target="_blank" rel="noreferrer" className="text-[var(--k-text)] text-sm hover:underline font-semibold shrink-0">
                    {t.open}
                  </a>
                ) : (
                  <div className="text-[var(--k-text-muted)] text-sm shrink-0">—</div>
                )}
              </div>
            ))
          ) : (
            <div className="text-[var(--k-text-muted)] text-sm">{t.noAttachments}</div>
          )}
        </div>
      </div>

            </div>

            <div className="lg:sticky lg:top-0">
              <div className="rounded-2xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] p-5 space-y-3 min-h-[520px] max-h-[min(80vh,760px)] overflow-hidden flex flex-col">
                <div className="flex items-center justify-between gap-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-[var(--k-text-muted)]">{t.comments}</div>
                  <div className="text-[var(--k-text-muted)] text-xs">
                    {card.comments.length} {locale === "en" ? "items" : "шт."}
                  </div>
                </div>
                <div className="text-[var(--k-text-muted)] text-xs">{t.all}</div>

                <div className="space-y-3 flex-1 overflow-y-auto pr-1">
                  {card.comments.length ? (
                    card.comments.map((c) => (
                      <div key={c.id} className="rounded-xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] p-3">
                        <div className="flex items-baseline justify-between gap-3">
                          <div className="text-[var(--k-text)] text-sm font-semibold truncate">
                            {c.author_full_name || c.author_email}
                          </div>
                          <div className="text-[var(--k-text-muted)] text-xs">
                            {c.created_at ? new Date(c.created_at).toLocaleString(locale === "en" ? "en-US" : "ru-RU") : ""}
                          </div>
                        </div>
                        <div className="text-[var(--k-text-muted)] text-sm mt-2 whitespace-pre-wrap">{c.body}</div>
                      </div>
                    ))
                  ) : (
                    <div className="text-[var(--k-text-muted)] text-sm">{t.noComments}</div>
                  )}
                </div>

                {onAddComment ? (
                  <div className="pt-2 border-t border-[var(--k-border)]">
                    <textarea
                      value={commentBody}
                      onChange={(e) => setCommentBody(e.target.value)}
                      rows={3}
                      className="w-full resize-none rounded-2xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] p-3 text-[var(--k-text)] outline-none focus:border-[#8A2BE2]"
                      placeholder={t.writeComment}
                    />
                    <div className="mt-3 flex items-center justify-end gap-3">
                      <button
                        onClick={() => submitComment()}
                        disabled={commentBusy}
                        className="px-6 py-2 rounded-full bg-gradient-to-r from-[#8A2BE2] to-[#4B0082] text-white font-semibold transition-colors hover:bg-gray-300 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {commentBusy ? t.sending : t.send}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        {localNotice ? (
          <div className="mt-4 rounded-xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] p-3 text-sm text-[var(--k-text)]">
            {localNotice}
          </div>
        ) : null}

        <Dialog
          open={addActionsDialogOpen}
          onClose={() => setAddActionsDialogOpen(false)}
          fullWidth
          maxWidth="xs"
          slotProps={{ paper: { sx: dialogPaperSx } }}
        >
          <DialogTitle sx={{ fontSize: 18, fontWeight: 700 }}>{t.addToCard}</DialogTitle>
          <DialogContent sx={{ pt: 0 }}>
            <div className="flex flex-col gap-1 max-h-[min(60vh,440px)] overflow-y-auto pr-0.5">
              {onUpdateCard ? (
                <button type="button" className={addMenuRowClass} onClick={() => void handleAddMenuAction("due")}>
                  {t.addMenuDue}
                </button>
              ) : null}
              {onUpsertFieldValue ? (
                <button type="button" className={addMenuRowClass} onClick={() => void handleAddMenuAction("tags")}>
                  {t.addMenuTags}
                </button>
              ) : null}
              {onAddChecklist ? (
                <button type="button" className={addMenuRowClass} onClick={() => void handleAddMenuAction("checklist")}>
                  {t.addMenuChecklist}
                </button>
              ) : null}
              {onAddAttachmentUrl ? (
                <button type="button" className={addMenuRowClass} onClick={() => void handleAddMenuAction("link")}>
                  {t.addMenuLink}
                </button>
              ) : null}
              {onUploadAttachment ? (
                <button type="button" className={addMenuRowClass} onClick={() => void handleAddMenuAction("file")}>
                  {t.addMenuFile}
                </button>
              ) : null}
              {onUpsertFieldValue ? (
                <button type="button" className={addMenuRowClass} onClick={() => void handleAddMenuAction("parent")}>
                  {t.addMenuParent}
                </button>
              ) : null}
              {onUpsertFieldValue ? (
                <button type="button" className={addMenuRowClass} onClick={() => void handleAddMenuAction("child")}>
                  {t.addMenuChild}
                </button>
              ) : null}
              {onAddChecklist ? (
                <button type="button" className={addMenuRowClass} onClick={() => void handleAddMenuAction("acceptance")}>
                  {t.addMenuAcceptance}
                </button>
              ) : null}
              {onAddAttachmentUrl ? (
                <>
                  <button type="button" className={addMenuRowClass} onClick={() => void handleAddMenuAction("gdrive")}>
                    {t.addMenuGdrive}
                  </button>
                  <button type="button" className={addMenuRowClass} onClick={() => void handleAddMenuAction("dropbox")}>
                    {t.addMenuDropbox}
                  </button>
                </>
              ) : null}
              {onUpsertFieldValue ? (
                <button type="button" className={addMenuRowClass} onClick={() => void handleAddMenuAction("new-field")}>
                  {t.addMenuNewField}
                </button>
              ) : null}
              {onUpsertFieldValue ? (
                <button type="button" className={addMenuRowClass} onClick={() => void handleAddMenuAction("time-spent")}>
                  {t.addMenuTimeSpent}
                </button>
              ) : null}
              {onUpsertFieldValue ? (
                <button type="button" className={addMenuRowClass} onClick={() => void handleAddMenuAction("size")}>
                  {t.addMenuSize}
                </button>
              ) : null}
              {onUpsertFieldValue ? (
                <button type="button" className={addMenuRowClass} onClick={() => void handleAddMenuAction("timeline")}>
                  {t.addMenuTimeline}
                </button>
              ) : null}
            </div>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setAddActionsDialogOpen(false)} sx={{ color: "var(--k-text-muted)" }}>
              {t.cancel}
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog
          open={checklistModalOpen}
          onClose={() => {
            if (!checklistBusy) setChecklistModalOpen(false);
          }}
          fullWidth
          maxWidth="sm"
          slotProps={{ paper: { sx: dialogPaperSx } }}
        >
          <DialogTitle sx={{ fontSize: 18, fontWeight: 700 }}>{t.checklistModalTitle}</DialogTitle>
          <DialogContent>
            <Typography variant="body2" sx={{ color: "var(--k-text-muted)", mb: 1.5 }}>
              {locale === "en" ? "Add a title and optional poll options." : "Укажите название и при необходимости варианты опроса."}
            </Typography>
            <div className="space-y-3">
              <TextField
                autoFocus
                fullWidth
                value={checklistTitle}
                onChange={(e) => setChecklistTitle(e.target.value)}
                disabled={checklistBusy}
                label={t.checklistNameLabel}
                slotProps={{ input: { sx: { color: "var(--k-text)" } } }}
                sx={{
                  "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--k-border)" },
                  "& label": { color: "var(--k-text-muted)" },
                }}
              />
              <div>
                <Typography variant="caption" sx={{ color: "var(--k-text-muted)", display: "block", mb: 0.75 }}>
                  {locale === "en" ? "Mode" : "Режим"}
                </Typography>
                <select
                  value={checklistModeDraft}
                  onChange={(e) => setChecklistModeDraft((e.target.value as "checkbox" | "poll") || "checkbox")}
                  disabled={checklistBusy}
                  className="w-full rounded-xl border border-[var(--k-border)] bg-[var(--k-page-bg)] px-3 py-2.5 text-sm text-[var(--k-text)]"
                >
                  <option value="checkbox">{t.checklistModeCheckbox}</option>
                  <option value="poll">{t.checklistModePoll}</option>
                </select>
              </div>
              <TextField
                fullWidth
                multiline
                minRows={3}
                value={checklistOptionsRaw}
                onChange={(e) => setChecklistOptionsRaw(e.target.value)}
                disabled={checklistBusy}
                label={t.checklistOptionsPlaceholder}
                slotProps={{ input: { sx: { color: "var(--k-text)" } } }}
                sx={{
                  "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--k-border)" },
                  "& label": { color: "var(--k-text-muted)" },
                }}
              />
            </div>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button
              onClick={() => {
                if (!checklistBusy) setChecklistModalOpen(false);
              }}
              disabled={checklistBusy}
              sx={{ color: "var(--k-text-muted)" }}
            >
              {t.cancel}
            </Button>
            <Button
              variant="contained"
              disabled={checklistBusy || !checklistTitle.trim() || !onAddChecklist}
              onClick={() => void createChecklistFromModal()}
              sx={{ bgcolor: "#9C27B0", "&:hover": { bgcolor: "#7B1FA2" } }}
            >
              {checklistBusy ? t.adding : t.createChecklist}
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog
          open={blockDialogOpen}
          onClose={() => {
            if (!blockBusy) {
              setBlockDialogOpen(false);
              setBlockReasonDraft("");
            }
          }}
          fullWidth
          maxWidth="sm"
          slotProps={{
            paper: {
              sx: dialogPaperSx,
            },
          }}
        >
          <DialogTitle sx={{ fontSize: 18, fontWeight: 700 }}>{t.blockCard}</DialogTitle>
          <DialogContent>
            <Typography variant="body2" sx={{ color: "var(--k-text-muted)", mb: 1.5 }}>
              {t.blockReasonRequired}
            </Typography>
            <TextField
              autoFocus
              fullWidth
              multiline
              minRows={3}
              value={blockReasonDraft}
              onChange={(e) => setBlockReasonDraft(e.target.value)}
              disabled={blockBusy}
              label={t.blockReasonLabel}
              slotProps={{
                input: { sx: { color: "var(--k-text)" } },
              }}
              sx={{
                "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--k-border)" },
                "& label": { color: "var(--k-text-muted)" },
              }}
            />
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button
              onClick={() => {
                if (!blockBusy) {
                  setBlockDialogOpen(false);
                  setBlockReasonDraft("");
                }
              }}
              disabled={blockBusy}
              sx={{ color: "var(--k-text-muted)" }}
            >
              {t.cancel}
            </Button>
            <Button
              variant="contained"
              disabled={blockBusy || !blockReasonDraft.trim() || !onUpsertFieldValue}
              onClick={() => void submitBlockCard()}
              sx={{ bgcolor: "#9C27B0", "&:hover": { bgcolor: "#7B1FA2" } }}
            >
              {blockBusy ? t.adding : t.confirmBlock}
            </Button>
          </DialogActions>
        </Dialog>
      </div>
    </div>
    </div>
  );
}

