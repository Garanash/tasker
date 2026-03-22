import Link from "next/link";

export const metadata = {
  title: "Вики — AGB Tasks",
  description: "Справка по приложению AGB Tasks",
};

export default function WikiPage() {
  return (
    <div className="min-h-screen bg-[#0A0A0A] text-[#E0E0E0] px-4 py-12 sm:py-16">
      <div className="max-w-7xl mx-auto">
        <p className="text-sm text-[#A0A0A0] mb-5">
          <Link href="/app" className="text-[#9C27B0] hover:underline">
            ← Вернуться в приложение
          </Link>
        </p>
        <section className="rounded-3xl border border-[#2A2A2A] bg-[radial-gradient(circle_at_top_right,rgba(138,43,226,0.25),transparent_45%),#111111] p-8 sm:p-10 shadow-2xl mb-8">
          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight mb-3 bg-gradient-to-r from-white to-gray-500 bg-clip-text text-transparent">
            Вики AGB Tasks
          </h1>
          <p className="text-lg sm:text-xl text-[#A0A0A0] max-w-3xl">
            Практическое руководство по работе с задачами, командами и коммуникациями. Ниже — не только справка, но и рабочие
            сценарии, чтобы стартовать за 10 минут.
          </p>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-10">
          <div className="lg:col-span-8 rounded-2xl border border-[#2A2A2A] bg-[#111111] p-6">
            <h2 className="text-2xl font-bold text-white mb-4">Быстрый старт</h2>
            <ol className="space-y-3 text-[#A0A0A0] list-decimal pl-5">
              <li>Откройте пространство и выберите доску в левом меню.</li>
              <li>Создайте задачу через кнопку `+` и задайте ответственного.</li>
              <li>Перемещайте карточку по единому процессу: К выполнению → В работе → Проверка → Размещение → Выполнено.</li>
              <li>Для уточнений используйте мессенджер (иконка конверта в верхней панели).</li>
            </ol>
          </div>
          <div className="lg:col-span-4 rounded-2xl border border-[#2A2A2A] bg-[#111111] p-6">
            <h3 className="text-lg font-bold text-white mb-3">Роли в процессе</h3>
            <ul className="space-y-2 text-sm text-[#A0A0A0]">
              <li>Админ/менеджер: видят все колонки, включая «Задачи».</li>
              <li>Исполнитель: не видит колонку «Задачи».</li>
              <li>Статусы задач едины для всех ролей.</li>
              <li>При переходе в «Проверка» менеджер получает уведомление.</li>
            </ul>
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="rounded-2xl border border-[#2A2A2A] bg-[#111111] p-6">
            <h2 className="text-xl font-bold text-white mb-3">Пример 1: Цикл задачи</h2>
            <div className="text-[#A0A0A0] text-sm leading-relaxed space-y-2">
              <p><strong className="text-white">Сценарий:</strong> менеджер ставит задачу «Подготовить релиз 2.4».</p>
              <p>1) Карточка создается в «Задачи» и назначается исполнителю.</p>
              <p>2) Исполнитель видит её в рабочих колонках, двигает в «В работе».</p>
              <p>3) После завершения переводит в «Проверка».</p>
              <p>4) Менеджер получает уведомление, проверяет результат, двигает дальше в «Размещение» и «Выполнено».</p>
            </div>
          </section>

          <section className="rounded-2xl border border-[#2A2A2A] bg-[#111111] p-6">
            <h2 className="text-xl font-bold text-white mb-3">Пример 2: Коммуникация в мессенджере</h2>
            <div className="text-[#A0A0A0] text-sm leading-relaxed space-y-2">
              <p><strong className="text-white">Сценарий:</strong> исполнитель блокируется по задаче и пишет менеджеру.</p>
              <p>1) Нажимает иконку сообщений в шапке.</p>
              <p>2) Выбирает контакт в левой панели.</p>
              <p>3) В правой части ведет переписку по задаче, не покидая рабочий экран.</p>
            </div>
          </section>

          <section className="rounded-2xl border border-[#2A2A2A] bg-[#111111] p-6">
            <h2 className="text-xl font-bold text-white mb-3">Фильтры и представления</h2>
            <p className="text-[#A0A0A0] text-sm leading-relaxed">
              Используйте переключатель видов (доска, список, таблица, таймлайн, календарь) и кнопку «Фильтры» для точного поиска
              по тексту, статусу, ответственному, приоритету и сроку. Это основной способ быстро находить задачи в больших досках.
            </p>
          </section>

          <section className="rounded-2xl border border-[#2A2A2A] bg-[#111111] p-6">
            <h2 className="text-xl font-bold text-white mb-3">Профиль и безопасность</h2>
            <p className="text-[#A0A0A0] text-sm leading-relaxed mb-2">
              Меню профиля в правом верхнем углу: имя, аватар, язык интерфейса, тема и смена пароля.
            </p>
            <p className="text-[#A0A0A0] text-sm leading-relaxed">
              Для внешней корпоративной базы знаний можно задать{" "}
              <code className="text-[#E0E0E0] bg-[#1A1A1A] px-1.5 py-0.5 rounded">NEXT_PUBLIC_WIKI_URL</code>.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
