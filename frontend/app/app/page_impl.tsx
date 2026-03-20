"use client";

import { useEffect, useMemo, useState } from "react";
import { getApiUrl } from "@/lib/api";
import { MotionDiv } from "../../components/MotionDiv";
import { KanbanBoard } from "../../components/kanban/KanbanBoard";
import { BurndownChart } from "../../components/scrum/BurndownChart";
import { ThroughputChart } from "../../components/analytics/ThroughputChart";

type AuthToken = { access: string; refresh?: string };
type Board = { id: string; name: string };

type BurndownDatum = {
  date: string;
  remaining_points: number;
  remaining_cards: number;
  done_cards: number;
};

type ScrumMetrics = {
  sprint: { id: string; name: string };
  velocity_cards: number;
  velocity_points: number;
  capacity_points: number;
  burndown: BurndownDatum[];
};

type GanttTask = {
  id: string;
  title: string;
  card_type: string;
  due_at: string | null;
  planned_start_at: string | null;
  planned_end_at: string | null;
  estimate_points: number | null;
  column_id: string | null;
};

type GanttPlan = {
  board_id: string;
  tasks: GanttTask[];
  dependencies: Array<{ from_card_id: string; to_card_id: string }>;
  time_range: { start: string; end: string } | null;
};

type AnalyticsSummary = {
  summary: {
    lead_time_avg_hours: number;
    cycle_time_avg_hours: number;
    block_time_avg_hours: number;
    done_cards_total: number;
  };
  throughput: Array<{ date: string; done_cards: number }>;
};

type Ticket = {
  id: string;
  title: string;
  status: string;
  priority: number;
  requester_name: string;
  requester_email: string;
};

type KanbanAnalytics = {
  board: { id: string; name: string };
  metrics: {
    lead_time_avg_hours: number;
    cycle_time_avg_hours: number;
    block_time_avg_hours: number;
    done_cards_total: number;
  };
  throughput: Array<{ date: string; done_cards: number }>;
  cfd: {
    days: string[];
    columns: Array<{ id: string; name: string; counts: number[] }>;
  };
};

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <div className="text-text1 text-sm mb-2">{label}</div>
      <input
        value={value}
        type={type}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-line bg-card px-3 py-2 text-text0 outline-none focus:border-gray-600"
      />
    </label>
  );
}

export default function AppHomePageImpl() {
  const [token, setToken] = useState<AuthToken | null>(null);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [scrumLoading, setScrumLoading] = useState(false);
  const [scrumError, setScrumError] = useState<string | null>(null);
  const [scrumMetrics, setScrumMetrics] = useState<ScrumMetrics | null>(null);
  const [ganttPlan, setGanttPlan] = useState<GanttPlan | null>(null);

  const [orgId, setOrgId] = useState<string | null>(null);

  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [analyticsSummary, setAnalyticsSummary] = useState<AnalyticsSummary | null>(null);

  const [kanbanAnalyticsLoading, setKanbanAnalyticsLoading] = useState(false);
  const [kanbanAnalyticsError, setKanbanAnalyticsError] = useState<string | null>(null);
  const [kanbanAnalytics, setKanbanAnalytics] = useState<KanbanAnalytics | null>(null);

  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketsError, setTicketsError] = useState<string | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [newTicketTitle, setNewTicketTitle] = useState("Проблема в сервисе");
  const [newTicketDescription, setNewTicketDescription] = useState("Кратко опишите проблему...");
  const [ticketComment, setTicketComment] = useState("Спасибо, уже проверяем.");

  const [externalTicketId, setExternalTicketId] = useState("");
  const [externalToken, setExternalToken] = useState("");
  const [externalComment, setExternalComment] = useState("Здравствуйте! Уточните детали, пожалуйста.");
  const [externalCreateName, setExternalCreateName] = useState("Внешний клиент");
  const [externalCreateEmail, setExternalCreateEmail] = useState("client@test.com");
  const [externalCreateTitle, setExternalCreateTitle] = useState("Заявка через портал");
  const [externalCreateDescription, setExternalCreateDescription] = useState("Что-то пошло не так...");

  const [mode, setMode] = useState<"login" | "register">("register");
  const [email, setEmail] = useState("ex@test.com");
  const [password, setPassword] = useState("password123");
  const [org, setOrg] = useState("Org1");

  useEffect(() => {
    try {
      const raw = localStorage.getItem("kaiten_access");
      if (raw) setToken({ access: raw });
    } catch {
      // ignore
    }
  }, []);


  useEffect(() => {
    if (!token) return;
    const access = token.access;
    let cancelled = false;

    async function bootstrap() {
      setLoading(true);
      setError(null);
      try {
        const meRes = await fetch(getApiUrl("/api/auth/me"), {
          headers: { Authorization: `Bearer ${access}` },
        });
        if (meRes.ok) {
          const me = (await meRes.json()) as any;
          const org = me?.memberships?.[0]?.organization_id as string | undefined;
          if (!cancelled && org) setOrgId(org);
        }

        const listRes = await fetch(getApiUrl("/api/kanban/boards"), {
          headers: { Authorization: `Bearer ${access}` },
        });
        const list = (await listRes.json()) as any[];

        if (!cancelled && list.length > 0) {
          setBoardId(list[0].id);
          return;
        }

        if (!cancelled) {
          const bootRes = await fetch(getApiUrl("/api/kanban/bootstrap"), {
            method: "POST",
            headers: { Authorization: `Bearer ${access}` },
          });
          const boot = (await bootRes.json()) as { board_id: string };
          setBoardId(boot.board_id);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Ошибка");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!token || !boardId) return;

    const access = token.access;
    let cancelled = false;

    async function loadKanbanAnalytics() {
      setKanbanAnalyticsLoading(true);
      setKanbanAnalyticsError(null);

      try {
        const res = await fetch(getApiUrl(`/api/analytics/kanban/boards/${boardId}?days=14`), {
          headers: { Authorization: `Bearer ${access}` },
        });

        const data = (await res.json()) as KanbanAnalytics;
        if (!cancelled && res.ok) setKanbanAnalytics(data);
        if (!cancelled && !res.ok) setKanbanAnalyticsError("Не удалось загрузить Kanban отчеты");
      } catch (e: any) {
        if (!cancelled) setKanbanAnalyticsError(e?.message ?? "Ошибка загрузки Kanban отчетов");
      } finally {
        if (!cancelled) setKanbanAnalyticsLoading(false);
      }
    }

    loadKanbanAnalytics();
    return () => {
      cancelled = true;
    };
  }, [token, boardId]);

  useEffect(() => {
    if (!token) return;
    const access = token.access;
    let cancelled = false;

    async function loadAnalyticsAndTickets() {
      setAnalyticsLoading(true);
      setAnalyticsError(null);
      setTicketsLoading(true);
      setTicketsError(null);
      try {
        const aRes = await fetch(getApiUrl("/api/analytics/summary?days=14"), {
          headers: { Authorization: `Bearer ${access}` },
        });
        if (aRes.ok) {
          const a = (await aRes.json()) as AnalyticsSummary;
          if (!cancelled) setAnalyticsSummary(a);
        } else {
          if (!cancelled) setAnalyticsError("Не удалось загрузить отчеты");
        }

        const tRes = await fetch(getApiUrl("/api/service-desk/tickets"), {
          headers: { Authorization: `Bearer ${access}` },
        });
        if (tRes.ok) {
          const t = (await tRes.json()) as Ticket[];
          if (!cancelled) setTickets(t.slice(0, 5));
        } else {
          if (!cancelled) setTicketsError("Не удалось загрузить тикеты");
        }
      } catch (e: any) {
        if (!cancelled) {
          setAnalyticsError(e?.message ?? "Ошибка загрузки");
          setTicketsError(e?.message ?? "Ошибка загрузки");
        }
      } finally {
        if (!cancelled) {
          setAnalyticsLoading(false);
          setTicketsLoading(false);
        }
      }
    }

    loadAnalyticsAndTickets();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const title = useMemo(() => (mode === "register" ? "Регистрация" : "Вход"), [mode]);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const url = getApiUrl(`/api/auth/${mode === "register" ? "register" : "login"}`);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body:
          mode === "register"
            ? JSON.stringify({ email, password, organization_name: org })
            : JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail ?? "Ошибка авторизации");

      setToken({ access: data.access, refresh: data.refresh });
      localStorage.setItem("kaiten_access", data.access);
    } catch (e: any) {
      setError(e?.message ?? "Ошибка");
    } finally {
      setLoading(false);
    }
  }

  async function createInternalTicket() {
    if (!token) return;
    const access = token.access;
    setTicketsLoading(true);
    setTicketsError(null);
    try {
      const res = await fetch(getApiUrl("/api/service-desk/tickets"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${access}` },
        body: JSON.stringify({
          title: newTicketTitle,
          description: newTicketDescription,
          priority: 0,
          requester_name: "Пользователь",
          requester_email: "user",
          assigned_to_id: null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail ?? "Не удалось создать тикет");

      const tRes = await fetch(getApiUrl("/api/service-desk/tickets"), {
        headers: { Authorization: `Bearer ${access}` },
      });
      const t = (await tRes.json()) as Ticket[];
      setTickets(t.slice(0, 5));
    } catch (e: any) {
      setTicketsError(e?.message ?? "Ошибка");
    } finally {
      setTicketsLoading(false);
    }
  }

  async function resolveFirstTicket() {
    if (!token) return;
    const access = token.access;
    const first = tickets[0];
    if (!first) return;

    const res = await fetch(getApiUrl(`/api/service-desk/tickets/${first.id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${access}` },
      body: JSON.stringify({ status: "resolved", assigned_to_id: null }),
    });
    if (!res.ok) return;

    const tRes = await fetch(getApiUrl("/api/service-desk/tickets"), {
      headers: { Authorization: `Bearer ${access}` },
    });
    const t = (await tRes.json()) as Ticket[];
    setTickets(t.slice(0, 5));
  }

  async function addCommentToFirstTicket() {
    if (!token) return;
    const access = token.access;
    const first = tickets[0];
    if (!first) return;

    await fetch(getApiUrl(`/api/service-desk/tickets/${first.id}/comments`), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${access}` },
      body: JSON.stringify({ body: ticketComment }),
    });

    setTicketComment("Спасибо, уже проверяем.");
  }

  async function createExternalTicket() {
    if (!orgId) return;
    const res = await fetch(getApiUrl("/api/service-desk/public/tickets"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organization_id: orgId,
        requester_name: externalCreateName,
        requester_email: externalCreateEmail,
        title: externalCreateTitle,
        description: externalCreateDescription,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.detail ?? "Не удалось создать внешний тикет");
    }
    setExternalTicketId(data.ticket.id);
    setExternalToken(data.public_token);
  }

  async function sendExternalComment() {
    if (!externalTicketId || !externalToken) return;
    const res = await fetch(getApiUrl(`/api/service-desk/public/tickets/${externalTicketId}/comments`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Public-Token": externalToken,
      },
      body: JSON.stringify({ body: externalComment }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.detail ?? "Не удалось отправить ответ");
    }
    setExternalToken(data.next_public_token);
    setExternalComment("");
  }

  async function createScrumDemoSprint() {
    if (!token || !boardId) return;

    setScrumLoading(true);
    setScrumError(null);
    try {
      const access = token.access;

      // Делаем небольшой "актуальный" спринт около текущей даты.
      const start = new Date();
      start.setDate(start.getDate() - 1);
      const end = new Date();
      end.setDate(end.getDate() + 6);

      const sprintRes = await fetch(getApiUrl("/api/scrum/sprints"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          board_id: boardId,
          name: "Sprint (demo)",
          goal: "MVP demo",
          start_at: start.toISOString(),
          end_at: end.toISOString(),
        }),
      });
      const sprint = await sprintRes.json();
      if (!sprintRes.ok) throw new Error(sprint?.detail ?? "Не удалось создать спринт");

      // Добавляем емкость текущему пользователю, чтобы UI мог показать загрузку.
      const meRes = await fetch(getApiUrl("/api/auth/me"), {
        headers: { Authorization: `Bearer ${access}` },
      });
      const me = await meRes.json();
      const userId = me?.user?.id as string | undefined;
      if (!userId) throw new Error("Не удалось получить текущего пользователя");

      const capRes = await fetch(getApiUrl(`/api/scrum/sprints/${sprint.id}/capacities`), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ user_id: userId, allocated_points: 20 }),
      });
      if (!capRes.ok) {
        const cap = await capRes.json().catch(() => ({}));
        throw new Error(cap?.detail ?? "Не удалось создать емкость");
      }

      const metricsRes = await fetch(getApiUrl(`/api/scrum/sprints/${sprint.id}/metrics`), {
        headers: { Authorization: `Bearer ${access}` },
      });
      const metrics = await metricsRes.json();
      if (!metricsRes.ok) throw new Error(metrics?.detail ?? "Не удалось загрузить метрики");

      setScrumMetrics(metrics as ScrumMetrics);

      const ganttRes = await fetch(getApiUrl(`/api/gantt/boards/${boardId}/plan`), {
        headers: { Authorization: `Bearer ${access}` },
      });
      const gantt = await ganttRes.json();
      if (!ganttRes.ok) throw new Error(gantt?.detail ?? "Не удалось загрузить Gantt");
      setGanttPlan(gantt as GanttPlan);
    } catch (e: any) {
      setScrumError(e?.message ?? "Ошибка Scrum");
    } finally {
      setScrumLoading(false);
    }
  }

  return (
    <div className="px-4 sm:px-6 max-w-7xl mx-auto py-16">
      <div className="flex items-start justify-between gap-6">
        <MotionDiv>
          <div>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">Kanban Console</h2>
            <p className="text-[#A0A0A0] mt-3 max-w-xl">DnD + realtime на базе backend клона.</p>
          </div>
        </MotionDiv>

        {token ? (
          <button
            onClick={() => {
              setToken(null);
              setBoardId(null);
              localStorage.removeItem("kaiten_access");
            }}
            className="rounded-full px-6 py-3 border border-[#2A2A2A] text-[#E0E0E0] hover:border-[#3A3A3A] transition-all"
          >
            Выйти
          </button>
        ) : null}
      </div>

      {!token ? (
        <div className="mt-10 grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 rounded-2xl border border-[#2A2A2A] bg-[#111111] p-6 shadow-lg">
            <div className="text-[#A0A0A0] text-sm">Авторизация</div>
            <div className="mt-4 flex gap-3">
              <button
                onClick={() => setMode("register")}
                className={
                  "flex-1 rounded-full px-4 py-2 transition-all border " +
                  (mode === "register"
                    ? "bg-gradient-to-r from-[#8A2BE2] to-[#4B0082] text-white"
                    : "bg-transparent border-[#2A2A2A] text-[#E0E0E0]")
                }
              >
                Register
              </button>
              <button
                onClick={() => setMode("login")}
                className={
                  "flex-1 rounded-full px-4 py-2 transition-all border " +
                  (mode === "login"
                    ? "bg-gradient-to-r from-[#8A2BE2] to-[#4B0082] text-white"
                    : "bg-transparent border-[#2A2A2A] text-[#E0E0E0]")
                }
              >
                Login
              </button>
            </div>

            <div className="mt-5 text-[#E0E0E0] font-semibold">{title}</div>

            <div className="mt-4 space-y-4">
              <Field label="Email" value={email} onChange={setEmail} type="email" />
              <Field label="Пароль" value={password} onChange={setPassword} type="password" />
              {mode === "register" ? <Field label="Организация" value={org} onChange={setOrg} /> : null}

              {error ? <div className="text-sm text-red-400">{error}</div> : null}

              <button
                onClick={submit}
                disabled={loading}
                className="w-full rounded-full px-8 py-3 text-white font-semibold bg-gradient-to-r from-[#8A2BE2] to-[#4B0082] shadow-tech hover:scale-105 transition-all duration-300 disabled:opacity-50"
              >
                {loading ? "Подождите..." : title}
              </button>
            </div>
          </div>

          <div className="lg:col-span-8 rounded-2xl border border-[#2A2A2A] bg-[#111111] p-6 shadow-lg">
            <div className="text-[#A0A0A0] text-sm">Что можно проверить</div>
            <div className="mt-4 h-[300px] rounded-xl border border-[#2A2A2A] bg-[#0F0F0F] flex items-center justify-center text-[#A0A0A0]">
              После логина создадим демо board и включим realtime.
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-10">
          {error ? <div className="mb-4 text-red-400 text-sm">{error}</div> : null}
          {!boardId ? (
            <div className="h-64 rounded-2xl border border-[#2A2A2A] bg-[#111111] flex items-center justify-center text-[#A0A0A0]">
              Генерация демо доски...
            </div>
          ) : (
            <div className="space-y-6">
              <KanbanBoard boardId={boardId} token={token.access} />

              <div className="rounded-2xl border border-[#2A2A2A] bg-[#111111] p-6 shadow-lg">
                <div className="flex items-start justify-between gap-6">
                  <div>
                    <div className="text-[#A0A0A0] text-sm">Scrum / Burndown</div>
                    <div className="text-[#E0E0E0] font-bold text-2xl tracking-tight mt-1">
                      {scrumMetrics ? scrumMetrics.sprint.name : "Демо спринта"}
                    </div>
                    {scrumMetrics ? (
                      <div className="mt-3 text-[#A0A0A0] text-sm">
                        Velocity: <span className="text-[#E0E0E0]">{scrumMetrics.velocity_points}</span> очков
                        {" • "}
                        Capacity: <span className="text-[#E0E0E0]">{scrumMetrics.capacity_points}</span>
                      </div>
                    ) : null}
                  </div>

                  <div className="min-w-[220px]">
                    {scrumMetrics ? (
                      <button
                        onClick={() => {
                          setScrumMetrics(null);
                          setGanttPlan(null);
                        }}
                        className="w-full rounded-full px-6 py-3 border border-[#2A2A2A] text-[#E0E0E0] hover:border-[#3A3A3A] transition-all"
                      >
                        Скрыть
                      </button>
                    ) : (
                      <button
                        onClick={createScrumDemoSprint}
                        disabled={scrumLoading}
                        className="w-full rounded-full px-8 py-3 text-white font-semibold bg-gradient-to-r from-[#8A2BE2] to-[#4B0082] shadow-tech hover:scale-105 transition-all duration-300 disabled:opacity-50"
                      >
                        {scrumLoading ? "Создаём..." : "Создать спринт демо"}
                      </button>
                    )}
                  </div>
                </div>

                {scrumError ? <div className="mt-4 text-sm text-red-400">{scrumError}</div> : null}

                {scrumMetrics ? (
                  <div className="mt-5 space-y-4">
                    <BurndownChart data={scrumMetrics.burndown} />

                    {ganttPlan ? (
                      <div className="rounded-2xl border border-[#2A2A2A] bg-[#0F0F0F] p-4">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <div className="text-[#A0A0A0] text-sm">Gantt / План</div>
                            <div className="text-[#E0E0E0] font-semibold tracking-tight mt-1">
                              {ganttPlan.tasks.length} задач • {ganttPlan.dependencies.length} зависимостей
                            </div>
                          </div>
                          <div className="text-[#A0A0A0] text-sm">
                            {ganttPlan.time_range
                              ? `${new Date(ganttPlan.time_range.start).toLocaleDateString(
                                  "ru-RU"
                                )} → ${new Date(ganttPlan.time_range.end).toLocaleDateString("ru-RU")}`
                              : "—"}
                          </div>
                        </div>

                        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                          {ganttPlan.tasks.slice(0, 6).map((t) => (
                            <div
                              key={t.id}
                              className="rounded-xl border border-[#2A2A2A] bg-[#111111] p-3"
                            >
                              <div className="text-[#E0E0E0] font-medium truncate">{t.title}</div>
                              <div className="text-[#A0A0A0] text-xs mt-1">
                                {t.planned_end_at
                                  ? `План до: ${new Date(t.planned_end_at).toLocaleDateString("ru-RU")}`
                                  : "Без плановой даты"}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-5 h-[160px] rounded-xl border border-[#2A2A2A] bg-[#0F0F0F] flex items-center justify-center text-[#A0A0A0]">
                    Нажми кнопку, и мы создадим спринт + посчитаем burndown по попаданиям карточек в Done.
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-4 rounded-2xl border border-[#2A2A2A] bg-[#111111] p-6 shadow-lg">
                  <div className="text-[#A0A0A0] text-sm">Отчеты</div>
                  <div className="mt-4">
                    {analyticsLoading ? (
                      <div className="h-24 rounded-xl border border-[#2A2A2A] bg-[#0F0F0F] flex items-center justify-center text-[#A0A0A0]">
                        Загрузка...
                      </div>
                    ) : analyticsSummary ? (
                      <div className="space-y-3">
                        <div className="text-[#E0E0E0] font-bold text-xl tracking-tight">
                          {analyticsSummary.summary.done_cards_total} завершено
                        </div>
                        <div className="text-[#A0A0A0] text-sm">
                          Lead:{" "}
                          <span className="text-[#E0E0E0]">{analyticsSummary.summary.lead_time_avg_hours.toFixed(1)}</span>ч
                        </div>
                        <div className="text-[#A0A0A0] text-sm">
                          Cycle:{" "}
                          <span className="text-[#E0E0E0]">{analyticsSummary.summary.cycle_time_avg_hours.toFixed(1)}</span>ч
                        </div>
                        <div className="text-[#A0A0A0] text-sm">
                          Block:{" "}
                          <span className="text-[#E0E0E0]">{analyticsSummary.summary.block_time_avg_hours.toFixed(1)}</span>ч
                        </div>
                      </div>
                    ) : (
                      <div className="h-24 rounded-xl border border-[#2A2A2A] bg-[#0F0F0F] flex items-center justify-center text-[#A0A0A0]">
                        Нет данных
                      </div>
                    )}
                    {analyticsError ? <div className="mt-3 text-red-400 text-sm">{analyticsError}</div> : null}
                  </div>

                  <div className="mt-5">
                    {kanbanAnalyticsLoading ? (
                      <div className="h-20 rounded-xl border border-[#2A2A2A] bg-[#0F0F0F] flex items-center justify-center text-[#A0A0A0]">
                        Загрузка Kanban отчётов...
                      </div>
                    ) : kanbanAnalytics ? (
                      <div className="space-y-3">
                        <div className="rounded-xl border border-[#2A2A2A] bg-[#0F0F0F] p-3">
                          <div className="text-[#A0A0A0] text-xs">Kanban метрики</div>
                          <div className="text-[#E0E0E0] text-sm mt-2">
                            Lead: {kanbanAnalytics.metrics.lead_time_avg_hours.toFixed(1)}ч • Cycle:{" "}
                            {kanbanAnalytics.metrics.cycle_time_avg_hours.toFixed(1)}ч • Block:{" "}
                            {kanbanAnalytics.metrics.block_time_avg_hours.toFixed(1)}ч
                          </div>
                        </div>

                        <ThroughputChart data={kanbanAnalytics.throughput} />

                        <div className="rounded-2xl border border-[#2A2A2A] bg-[#0F0F0F] p-4">
                          <div className="text-[#A0A0A0] text-sm">CFD (последний день)</div>
                          <div className="mt-3 space-y-2">
                            {kanbanAnalytics.cfd.columns.map((col) => {
                              const lastCount = col.counts.length ? col.counts[col.counts.length - 1] : 0;
                              return (
                                <div key={col.id} className="flex items-center justify-between gap-3">
                                  <div className="text-[#E0E0E0] text-sm truncate">{col.name}</div>
                                  <div className="text-[#A0A0A0] text-sm">{lastCount}</div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    ) : kanbanAnalyticsError ? (
                      <div className="text-red-400 text-sm mt-3">{kanbanAnalyticsError}</div>
                    ) : (
                      <div className="h-20 rounded-xl border border-[#2A2A2A] bg-[#0F0F0F] flex items-center justify-center text-[#A0A0A0]">
                        Нет Kanban отчётов
                      </div>
                    )}
                  </div>
                </div>

                <div className="lg:col-span-4 rounded-2xl border border-[#2A2A2A] bg-[#111111] p-6 shadow-lg">
                  <div className="text-[#A0A0A0] text-sm">Service Desk (внутренний)</div>
                  <div className="mt-4 space-y-3">
                    <div className="text-[#E0E0E0] font-semibold">Создать тикет</div>
                    <input
                      value={newTicketTitle}
                      onChange={(e) => setNewTicketTitle(e.target.value)}
                      className="w-full rounded-lg border border-[#2A2A2A] bg-[#0F0F0F] px-3 py-2 text-[#E0E0E0] outline-none focus:border-[#3A3A3A]"
                    />
                    <textarea
                      value={newTicketDescription}
                      onChange={(e) => setNewTicketDescription(e.target.value)}
                      className="w-full h-20 resize-none rounded-lg border border-[#2A2A2A] bg-[#0F0F0F] px-3 py-2 text-[#E0E0E0] outline-none focus:border-[#3A3A3A]"
                    />
                    <button
                      onClick={() => createInternalTicket().catch(() => {})}
                      disabled={ticketsLoading}
                      className="w-full rounded-full px-8 py-3 text-white font-semibold bg-gradient-to-r from-[#8A2BE2] to-[#4B0082] shadow-tech hover:scale-105 transition-all duration-300 disabled:opacity-50"
                    >
                      {ticketsLoading ? "Создаём..." : "Создать"}
                    </button>
                    {ticketsError ? <div className="text-red-400 text-sm">{ticketsError}</div> : null}

                    <div className="pt-2">
                      <div className="text-[#A0A0A0] text-sm">Последние тикеты</div>
                      <div className="mt-2 space-y-2">
                        {tickets.map((t) => (
                          <div key={t.id} className="rounded-xl border border-[#2A2A2A] bg-[#0F0F0F] p-3">
                            <div className="text-[#E0E0E0] text-sm font-semibold">{t.title}</div>
                            <div className="text-[#A0A0A0] text-xs mt-1">{t.status}</div>
                          </div>
                        ))}
                        {tickets.length === 0 ? (
                          <div className="h-16 rounded-xl border border-[#2A2A2A] bg-[#0F0F0F] flex items-center justify-center text-[#A0A0A0]">
                            Пока пусто
                          </div>
                        ) : null}
                      </div>
                      <div className="mt-3">
                        <button
                          onClick={() => resolveFirstTicket().catch(() => {})}
                          disabled={tickets.length === 0}
                          className="w-full rounded-full px-6 py-2 border border-[#2A2A2A] text-[#E0E0E0] hover:border-[#3A3A3A] transition-all disabled:opacity-50"
                        >
                          Resolve первый
                        </button>
                      </div>
                      <div className="mt-3">
                        <input
                          value={ticketComment}
                          onChange={(e) => setTicketComment(e.target.value)}
                          className="w-full rounded-lg border border-[#2A2A2A] bg-[#0F0F0F] px-3 py-2 text-[#E0E0E0] outline-none focus:border-[#3A3A3A]"
                        />
                        <button
                          onClick={() => addCommentToFirstTicket().catch(() => {})}
                          disabled={tickets.length === 0}
                          className="mt-2 w-full rounded-full px-6 py-2 text-white font-semibold bg-gradient-to-r from-[#8A2BE2] to-[#4B0082] shadow-tech hover:scale-105 transition-all duration-300 disabled:opacity-50"
                        >
                          Комментарий
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-4 rounded-2xl border border-[#2A2A2A] bg-[#111111] p-6 shadow-lg">
                  <div className="text-[#A0A0A0] text-sm">Service Desk (внешний)</div>
                  <div className="mt-4 space-y-3">
                    <div className="text-[#E0E0E0] font-semibold">Создать тикет</div>
                    <input
                      value={externalCreateTitle}
                      onChange={(e) => setExternalCreateTitle(e.target.value)}
                      className="w-full rounded-lg border border-[#2A2A2A] bg-[#0F0F0F] px-3 py-2 text-[#E0E0E0] outline-none focus:border-[#3A3A3A]"
                    />
                    <textarea
                      value={externalCreateDescription}
                      onChange={(e) => setExternalCreateDescription(e.target.value)}
                      className="w-full h-20 resize-none rounded-lg border border-[#2A2A2A] bg-[#0F0F0F] px-3 py-2 text-[#E0E0E0] outline-none focus:border-[#3A3A3A]"
                    />
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <input
                        value={externalCreateName}
                        onChange={(e) => setExternalCreateName(e.target.value)}
                        className="w-full rounded-lg border border-[#2A2A2A] bg-[#0F0F0F] px-3 py-2 text-[#E0E0E0] outline-none focus:border-[#3A3A3A]"
                        placeholder="Имя"
                      />
                      <input
                        value={externalCreateEmail}
                        onChange={(e) => setExternalCreateEmail(e.target.value)}
                        className="w-full rounded-lg border border-[#2A2A2A] bg-[#0F0F0F] px-3 py-2 text-[#E0E0E0] outline-none focus:border-[#3A3A3A]"
                        placeholder="Email"
                      />
                    </div>
                    <button
                      onClick={() => createExternalTicket().catch(() => {})}
                      disabled={!orgId}
                      className="w-full rounded-full px-8 py-3 text-white font-semibold bg-gradient-to-r from-[#8A2BE2] to-[#4B0082] shadow-tech hover:scale-105 transition-all duration-300 disabled:opacity-50"
                    >
                      Создать
                    </button>

                    {externalTicketId && externalToken ? (
                      <div className="pt-2">
                        <div className="text-[#A0A0A0] text-xs">Тикет</div>
                        <div className="text-[#E0E0E0] text-sm font-semibold break-all">{externalTicketId}</div>
                        <textarea
                          value={externalComment}
                          onChange={(e) => setExternalComment(e.target.value)}
                          className="mt-3 w-full h-20 resize-none rounded-lg border border-[#2A2A2A] bg-[#0F0F0F] px-3 py-2 text-[#E0E0E0] outline-none focus:border-[#3A3A3A]"
                        />
                        <button
                          onClick={() => sendExternalComment().catch(() => {})}
                          className="mt-2 w-full rounded-full px-8 py-3 text-white font-semibold bg-gradient-to-r from-[#8A2BE2] to-[#4B0082] shadow-tech hover:scale-105 transition-all duration-300"
                        >
                          Отправить ответ
                        </button>
                      </div>
                    ) : (
                      <div className="h-16 rounded-xl border border-[#2A2A2A] bg-[#0F0F0F] flex items-center justify-center text-[#A0A0A0]">
                        После создания появится token для ответа
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

