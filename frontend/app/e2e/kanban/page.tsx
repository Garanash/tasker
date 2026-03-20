"use client";

import { useEffect, useState } from "react";
import { getApiUrl } from "@/lib/api";
import { KanbanBoard } from "../../../components/kanban/KanbanBoard";

const E2E_EMAIL = "e2e@test.com";
const E2E_PASSWORD = "password123";
const E2E_ORG = "E2E Org";

type Token = { access: string };
type Space = { id: string; name: string };
type Board = { id: string; name: string };

export default function E2eKanbanPage() {
  const [token, setToken] = useState<Token | null>(null);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function ensureAuth(): Promise<string> {
      const loginRes = await fetch(getApiUrl("/api/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: E2E_EMAIL, password: E2E_PASSWORD }),
      });
      if (loginRes.ok) {
        const data = (await loginRes.json()) as { access: string };
        return data.access;
      }
      if (loginRes.status === 401) {
        const regRes = await fetch(getApiUrl("/api/auth/register"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: E2E_EMAIL,
            password: E2E_PASSWORD,
            organization_name: E2E_ORG,
            full_name: "E2E User",
          }),
        });
        if (!regRes.ok) {
          const err = (await regRes.json().catch(() => ({}))) as { detail?: string };
          throw new Error(err.detail ?? "Регистрация не удалась");
        }
        const regData = (await regRes.json()) as { access: string };
        return regData.access;
      }
      throw new Error("Логин не удался");
    }

    async function run() {
      try {
        const access = await ensureAuth();
        if (cancelled) return;
        setToken({ access });

        const spacesRes = await fetch(getApiUrl("/api/auth/spaces"), {
          headers: { Authorization: `Bearer ${access}` },
        });
        if (!spacesRes.ok) throw new Error("Не удалось загрузить пространства");
        const spaces = (await spacesRes.json()) as Space[];
        const spaceId = spaces[0]?.id;
        if (!spaceId) throw new Error("Нет пространств");

        const boardsRes = await fetch(getApiUrl("/api/kanban/boards"), {
          headers: { Authorization: `Bearer ${access}`, "X-Space-Id": spaceId },
        });
        if (!boardsRes.ok) throw new Error("Не удалось загрузить доски");
        let boards = (await boardsRes.json()) as Board[];

        if (!boards.length) {
          const bootRes = await fetch(getApiUrl("/api/kanban/bootstrap"), {
            method: "POST",
            headers: { Authorization: `Bearer ${access}`, "X-Space-Id": spaceId },
            body: JSON.stringify({}),
          });
          if (!bootRes.ok) {
            const err = (await bootRes.json().catch(() => ({}))) as { detail?: string };
            throw new Error(err.detail ?? "Bootstrap не удался");
          }
          const boot = (await bootRes.json()) as { board_id: string };
          boards = [{ id: boot.board_id, name: "Демо-доска" }];
        }

        if (cancelled) return;
        setBoardId(boards[0].id);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="px-4 py-16 max-w-7xl mx-auto">
        <div className="text-gray-900 font-bold text-xl">Загрузка...</div>
        <div className="text-gray-500 mt-2">Авторизация и подготовка доски</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-16 max-w-7xl mx-auto">
        <div className="text-red-600 font-bold text-xl">Ошибка</div>
        <div className="text-gray-700 mt-2">{error}</div>
        <div className="text-gray-500 mt-4 text-sm">Убедитесь, что бэкенд запущен на порту 8000.</div>
      </div>
    );
  }

  if (!token || !boardId) {
    return (
      <div className="px-4 py-16 max-w-7xl mx-auto">
        <div className="text-gray-900 font-bold text-xl">Нет доски</div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 max-w-7xl mx-auto py-8">
      <div className="text-gray-900 font-extrabold tracking-tight text-2xl mb-1">Kanban (e2e)</div>
      <div className="text-gray-500 text-sm mb-6">Реальная доска через API</div>
      <KanbanBoard boardId={boardId} token={token.access} />
    </div>
  );
}
