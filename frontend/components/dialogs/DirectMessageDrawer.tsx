"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  Box,
  CircularProgress,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItemButton,
  TextField,
  Typography,
  Avatar,
  Divider,
  InputAdornment,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import SendIcon from "@mui/icons-material/Send";
import SearchIcon from "@mui/icons-material/Search";
import { getApiUrl, getWsUrl } from "@/lib/api";

export type DmPeer = {
  id: string;
  full_name: string;
  email: string;
  role: string;
  avatar_url?: string;
};

type Msg = {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  created_at: string | null;
  organization_id?: string;
};

type ConversationSummaryItem = {
  peer_user_id: string;
  last_message_id: string | null;
  last_sender_id: string | null;
  last_message_body: string;
  last_message_at: string | null;
  unread_count: number;
};

type ConversationMeta = {
  unread_count: number;
  last_message_at: string | null;
  last_message_body: string;
  last_sender_id: string | null;
};

export default function DirectMessageDrawer({
  open,
  onClose,
  peers,
  initialPeerId,
  token,
  organizationId,
  currentUserId,
  language = "ru",
  onConversationRead,
}: {
  open: boolean;
  onClose: () => void;
  peers: DmPeer[];
  initialPeerId?: string | null;
  token: string;
  organizationId: string | null;
  currentUserId: string | null;
  language?: "ru" | "en";
  /** После отметки диалога прочитанным на сервере */
  onConversationRead?: () => void;
}) {
  const [selectedPeerId, setSelectedPeerId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contactsQuery, setContactsQuery] = useState("");
  const [conversationMetaByPeer, setConversationMetaByPeer] = useState<Record<string, ConversationMeta>>({});
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const contacts = useMemo(
    () =>
      peers
      .filter((p) => p.id !== currentUserId)
      .sort((a, b) => {
        const aMeta = conversationMetaByPeer[a.id];
        const bMeta = conversationMetaByPeer[b.id];
        const aTs = aMeta?.last_message_at ? Date.parse(aMeta.last_message_at) : Number.NEGATIVE_INFINITY;
        const bTs = bMeta?.last_message_at ? Date.parse(bMeta.last_message_at) : Number.NEGATIVE_INFINITY;
        if (aTs !== bTs) return bTs - aTs;
        const aUnread = aMeta?.unread_count ?? 0;
        const bUnread = bMeta?.unread_count ?? 0;
        if (aUnread !== bUnread) return bUnread - aUnread;
        const aName = (a.full_name || a.email || "").toLowerCase();
        const bName = (b.full_name || b.email || "").toLowerCase();
        return aName.localeCompare(bName);
      }),
    [peers, currentUserId, conversationMetaByPeer]
  );

  const filteredContacts = useMemo(() => {
    const query = contactsQuery.trim().toLowerCase();
    if (!query) return contacts;
    return contacts.filter((c) => {
      const fullName = (c.full_name || "").toLowerCase();
      const email = (c.email || "").toLowerCase();
      return fullName.includes(query) || email.includes(query);
    });
  }, [contacts, contactsQuery]);

  const selectedPeer = useMemo(
    () => contacts.find((c) => c.id === selectedPeerId) ?? null,
    [contacts, selectedPeerId]
  );

  useEffect(() => {
    if (!open) return;
    const preferred = (initialPeerId || "").trim();
    if (preferred && contacts.some((c) => c.id === preferred)) {
      setSelectedPeerId(preferred);
      return;
    }
    if (!selectedPeerId || !contacts.some((c) => c.id === selectedPeerId)) {
      setSelectedPeerId(contacts[0]?.id ?? null);
    }
  }, [open, initialPeerId, contacts, selectedPeerId]);

  const loadConversationSummary = useCallback(async () => {
    if (!open || !organizationId || !token) return;
    try {
      const res = await fetch(getApiUrl("/api/messages/conversations-summary"), {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Organization-Id": organizationId,
        },
      });
      const data = (await res.json().catch(() => ({}))) as { conversations?: ConversationSummaryItem[] };
      if (!res.ok || !Array.isArray(data.conversations)) return;
      const nextMeta: Record<string, ConversationMeta> = {};
      for (const row of data.conversations) {
        const peerId = String(row.peer_user_id || "").trim();
        if (!peerId) continue;
        nextMeta[peerId] = {
          unread_count: Number(row.unread_count || 0),
          last_message_at: row.last_message_at || null,
          last_message_body: row.last_message_body || "",
          last_sender_id: row.last_sender_id || null,
        };
      }
      setConversationMetaByPeer(nextMeta);
    } catch {
      // ignore summary errors, history still works
    }
  }, [open, organizationId, token]);

  useEffect(() => {
    void loadConversationSummary();
  }, [loadConversationSummary]);

  const loadHistory = useCallback(async () => {
    if (!selectedPeer || !organizationId || !token) {
      setMessages([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(getApiUrl(`/api/messages/history/${selectedPeer.id}`), {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Organization-Id": organizationId,
        },
      });
      const data = (await res.json().catch(() => ({}))) as { messages?: Msg[]; detail?: string };
      if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "load failed");
      const history = Array.isArray(data.messages) ? data.messages : [];
      setMessages(history);
      await fetch(getApiUrl("/api/messages/mark-read"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Organization-Id": organizationId,
        },
        body: JSON.stringify({ peer_user_id: selectedPeer.id }),
      }).catch(() => {});
      const last = history.length ? history[history.length - 1] : null;
      setConversationMetaByPeer((prev) => ({
        ...prev,
        [selectedPeer.id]: {
          unread_count: 0,
          last_message_at: last?.created_at ?? prev[selectedPeer.id]?.last_message_at ?? null,
          last_message_body: last?.body ?? prev[selectedPeer.id]?.last_message_body ?? "",
          last_sender_id: last?.sender_id ?? prev[selectedPeer.id]?.last_sender_id ?? null,
        },
      }));
      onConversationRead?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error");
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [selectedPeer, organizationId, token, onConversationRead]);

  useEffect(() => {
    if (!open) {
      setMessages([]);
      setInput("");
      setError(null);
      return;
    }
    void loadHistory();
  }, [open, selectedPeer?.id, loadHistory]);

  useEffect(() => {
    if (!open || !token) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      return;
    }
    const ws = new WebSocket(getWsUrl(`/ws/messages/?token=${encodeURIComponent(token)}`));
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data) as { type?: string; payload?: Msg };
        if (parsed.type !== "direct_message" || !parsed.payload || !currentUserId) return;
        const p = parsed.payload;
        if (p.organization_id && organizationId && p.organization_id !== organizationId) return;
        const peerId =
          p.sender_id === currentUserId
            ? p.recipient_id
            : p.recipient_id === currentUserId
              ? p.sender_id
              : null;
        if (!peerId) return;
        const isSelectedPeer = Boolean(selectedPeer && peerId === selectedPeer.id);
        const incomingForCurrentUser = p.recipient_id === currentUserId;
        setConversationMetaByPeer((prev) => {
          const existing = prev[peerId] || {
            unread_count: 0,
            last_message_at: null,
            last_message_body: "",
            last_sender_id: null,
          };
          return {
            ...prev,
            [peerId]: {
              unread_count:
                incomingForCurrentUser && !isSelectedPeer ? existing.unread_count + 1 : incomingForCurrentUser ? 0 : existing.unread_count,
              last_message_at: p.created_at ?? existing.last_message_at,
              last_message_body: p.body || existing.last_message_body,
              last_sender_id: p.sender_id || existing.last_sender_id,
            },
          };
        });
        if (!isSelectedPeer) return;
        setMessages((prev) => {
          if (prev.some((m) => m.id === p.id)) return prev;
          return [...prev, { id: p.id, sender_id: p.sender_id, recipient_id: p.recipient_id, body: p.body, created_at: p.created_at ?? null }];
        });
        if (incomingForCurrentUser && organizationId && selectedPeer) {
          void fetch(getApiUrl("/api/messages/mark-read"), {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              "X-Organization-Id": organizationId,
            },
            body: JSON.stringify({ peer_user_id: selectedPeer.id }),
          })
            .then(() => onConversationRead?.())
            .catch(() => {
              // ignore
            });
        }
      } catch {
        // ignore
      }
    };
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [open, token, selectedPeer?.id, currentUserId, organizationId, onConversationRead]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, open, loading]);

  const send = async () => {
    const text = input.trim();
    if (!text || !selectedPeer || !organizationId || !token || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(getApiUrl("/api/messages/send"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Organization-Id": organizationId,
        },
        body: JSON.stringify({ peer_user_id: selectedPeer.id, body: text }),
      });
      const data = (await res.json().catch(() => ({}))) as Msg & { detail?: string };
      if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "send failed");
      setInput("");
      setMessages((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data]));
      setConversationMetaByPeer((prev) => ({
        ...prev,
        [selectedPeer.id]: {
          unread_count: prev[selectedPeer.id]?.unread_count ?? 0,
          last_message_at: data.created_at ?? prev[selectedPeer.id]?.last_message_at ?? null,
          last_message_body: data.body || prev[selectedPeer.id]?.last_message_body || "",
          last_sender_id: data.sender_id || prev[selectedPeer.id]?.last_sender_id || null,
        },
      }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setSending(false);
    }
  };

  const t =
    language === "en"
      ? {
          title: "Messenger",
          contacts: "Contacts",
          send: "Send",
          placeholder: "Write a message…",
          close: "Close",
          emptyContacts: "No contacts in this organization.",
          emptyChat: "Select a contact and start chatting.",
          contactsSearch: "Search contact",
          recentDialogs: "Recent dialogs",
        }
      : {
          title: "Мессенджер",
          contacts: "Контакты",
          send: "Отправить",
          placeholder: "Напишите сообщение…",
          close: "Закрыть",
          emptyContacts: "В этой организации пока нет контактов.",
          emptyChat: "Выберите контакт и начните переписку.",
          contactsSearch: "Поиск контакта",
          recentDialogs: "Недавние диалоги",
        };

  function formatContactTime(iso: string | null): string {
    if (!iso) return "";
    const ts = Date.parse(iso);
    if (Number.isNaN(ts)) return "";
    const d = new Date(ts);
    return d.toLocaleTimeString(language === "en" ? "en-US" : "ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="lg"
      slotProps={{
        paper: {
          sx: {
            minHeight: "78vh",
            maxHeight: "92vh",
            bgcolor: "var(--k-surface-bg, #fff)",
            border: "1px solid var(--k-border, #e0e0e0)",
          },
        },
      }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 1,
          pr: 1,
          borderBottom: "1px solid var(--k-border, #e0e0e0)",
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography component="div" fontWeight={700} color="var(--k-text, #111)" noWrap>
            {t.title}
          </Typography>
          <Typography variant="caption" color="var(--k-text-muted, #666)" sx={{ display: "block" }}>
            {selectedPeer ? (selectedPeer.full_name || selectedPeer.email) : t.contacts}
          </Typography>
        </Box>
        <IconButton onClick={onClose} size="small" aria-label={t.close} sx={{ flexShrink: 0 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ p: 0, overflow: "hidden", display: "flex", flexDirection: "row" }}>
        <Box
          sx={{
            width: 300,
            flexShrink: 0,
            borderRight: "1px solid var(--k-border, #e0e0e0)",
            bgcolor: "var(--k-page-bg, #f5f5f5)",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          <Box sx={{ p: 1.25, borderBottom: "1px solid var(--k-border, #e0e0e0)" }}>
            <TextField
              fullWidth
              size="small"
              value={contactsQuery}
              onChange={(e) => setContactsQuery(e.target.value)}
              placeholder={t.contactsSearch}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" sx={{ color: "var(--k-text-muted, #666)" }} />
                  </InputAdornment>
                ),
              }}
            />
          </Box>
          <List sx={{ p: 0, overflow: "auto", minHeight: 0 }}>
            <Box sx={{ px: 1.5, py: 1, borderBottom: "1px solid var(--k-border, #e0e0e0)" }}>
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: "var(--k-text-muted, #666)", letterSpacing: 0.4 }}>
                {t.recentDialogs}
              </Typography>
            </Box>
            {!filteredContacts.length ? (
              <Box sx={{ px: 2, py: 3 }}>
                <Typography variant="body2" color="var(--k-text-muted, #666)">
                  {t.emptyContacts}
                </Typography>
              </Box>
            ) : (
              filteredContacts.map((contact) => {
                const isActive = contact.id === selectedPeerId;
                const fullName = contact.full_name?.trim() || contact.email;
                const letter = fullName.charAt(0).toUpperCase();
                const meta = conversationMetaByPeer[contact.id];
                const unread = Number(meta?.unread_count || 0);
                const preview = (meta?.last_message_body || "").trim() || contact.email;
                const previewTime = formatContactTime(meta?.last_message_at || null);
                return (
                  <ListItemButton
                    key={contact.id}
                    selected={isActive}
                    onClick={() => {
                      setSelectedPeerId(contact.id);
                      setInput("");
                      setError(null);
                    }}
                    sx={{
                      py: 1.25,
                      borderLeft: isActive ? "3px solid #8A2BE2" : "3px solid transparent",
                      alignItems: "flex-start",
                    }}
                  >
                    <Avatar
                      src={contact.avatar_url}
                      sx={{ width: 30, height: 30, fontSize: 13, bgcolor: "#4B0082", mr: 1.25, mt: 0.2 }}
                    >
                      {letter}
                    </Avatar>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
                        <Typography noWrap sx={{ fontSize: 14, fontWeight: 600, color: "var(--k-text, #111)", flex: 1 }}>
                          {fullName}
                        </Typography>
                        {previewTime ? (
                          <Typography sx={{ fontSize: 10, color: "var(--k-text-muted, #666)", flexShrink: 0 }}>
                            {previewTime}
                          </Typography>
                        ) : null}
                        {unread > 0 ? (
                          <Box
                            sx={{
                              minWidth: 18,
                              height: 18,
                              px: 0.75,
                              borderRadius: 999,
                              bgcolor: "#8A2BE2",
                              color: "#fff",
                              fontSize: 11,
                              lineHeight: "18px",
                              fontWeight: 700,
                              textAlign: "center",
                              flexShrink: 0,
                            }}
                          >
                            {unread > 99 ? "99+" : unread}
                          </Box>
                        ) : null}
                      </Box>
                      <Typography noWrap sx={{ fontSize: 12, color: "var(--k-text-muted, #666)" }}>
                        {preview}
                      </Typography>
                    </Box>
                  </ListItemButton>
                );
              })
            )}
          </List>
        </Box>

        <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {!selectedPeer ? (
            <Box sx={{ flex: 1, display: "grid", placeItems: "center", px: 3 }}>
              <Typography sx={{ color: "var(--k-text-muted, #666)", textAlign: "center" }}>{t.emptyChat}</Typography>
            </Box>
          ) : (
            <>
              <Box
                sx={{
                  px: 2,
                  py: 1.25,
                  borderBottom: "1px solid var(--k-border, #e0e0e0)",
                  bgcolor: "var(--k-surface-bg, #fff)",
                }}
              >
                <Typography sx={{ fontWeight: 700, color: "var(--k-text, #111)" }}>
                  {selectedPeer.full_name?.trim() || selectedPeer.email}
                </Typography>
                <Typography variant="caption" sx={{ color: "var(--k-text-muted, #666)" }}>
                  {selectedPeer.email}
                </Typography>
              </Box>
              {loading ? (
                <Box display="flex" justifyContent="center" alignItems="center" py={6} sx={{ flex: 1 }}>
                  <CircularProgress size={32} sx={{ color: "#8A2BE2" }} />
                </Box>
              ) : (
                <Box
                  sx={{
                    flex: 1,
                    overflow: "auto",
                    p: 2,
                    bgcolor: "var(--k-page-bg, #f5f5f5)",
                    minHeight: 0,
                  }}
                >
                  {messages.map((m) => {
                    const mine = m.sender_id === currentUserId;
                    return (
                      <Box
                        key={m.id}
                        sx={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start", mb: 1.25 }}
                      >
                        <Box
                          sx={{
                            maxWidth: "88%",
                            px: 1.5,
                            py: 1,
                            borderRadius: 2,
                            bgcolor: mine ? "transparent" : "var(--k-surface-bg, #fff)",
                            background: mine ? "linear-gradient(90deg, #8A2BE2 0%, #4B0082 100%)" : undefined,
                            color: mine ? "#fff" : "var(--k-text, #111)",
                            border: mine ? "none" : "1px solid var(--k-border, #e0e0e0)",
                            boxShadow: mine ? "0 2px 8px rgba(74, 0, 130, 0.25)" : "none",
                          }}
                        >
                          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                            {m.body}
                          </Typography>
                          {m.created_at ? (
                            <Typography
                              variant="caption"
                              sx={{
                                opacity: 0.85,
                                display: "block",
                                mt: 0.5,
                                fontSize: 10,
                              }}
                            >
                              {new Date(m.created_at).toLocaleString(language === "en" ? "en-US" : "ru-RU", {
                                day: "2-digit",
                                month: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </Typography>
                          ) : null}
                        </Box>
                      </Box>
                    );
                  })}
                  <div ref={bottomRef} />
                </Box>
              )}

              {error ? (
                <Typography color="error" variant="caption" sx={{ px: 2, py: 0.75 }}>
                  {error}
                </Typography>
              ) : null}

              <Divider />
              <Box
                sx={{
                  px: 2,
                  py: 1.5,
                  gap: 1,
                  display: "flex",
                  alignItems: "flex-end",
                }}
              >
                <TextField
                  fullWidth
                  size="small"
                  multiline
                  maxRows={4}
                  placeholder={t.placeholder}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2 } }}
                />
                <IconButton
                  onClick={() => void send()}
                  disabled={sending || !input.trim()}
                  aria-label={t.send}
                  sx={{
                    background: "linear-gradient(90deg, #8A2BE2, #4B0082)",
                    color: "#fff",
                    "&:hover": { background: "linear-gradient(90deg, #9d3cf5, #5a0099)" },
                    "&.Mui-disabled": { opacity: 0.5, color: "#fff" },
                  }}
                >
                  <SendIcon fontSize="small" />
                </IconButton>
              </Box>
            </>
          )}
        </Box>
      </DialogContent>
    </Dialog>
  );
}
