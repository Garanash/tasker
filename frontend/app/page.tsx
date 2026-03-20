import { MotionDiv } from "../components/MotionDiv";
import Link from "next/link";

export default function Page() {
  return (
    <div className="px-4 sm:px-6 max-w-7xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 py-24">
        <div className="lg:col-span-7">
          <MotionDiv>
            <h1 className="text-6xl sm:text-7xl font-extrabold tracking-tight leading-[0.95]">
              Мониторинг
              <span className="block bg-gradient-to-r from-white to-gray-500 bg-clip-text text-transparent">
                и постановка задач
              </span>
            </h1>
          </MotionDiv>
          <MotionDiv delay={0.1}>
            <p className="text-lg sm:text-xl text-[#A0A0A0] mt-6 max-w-xl">
              «Кайтен-клон» с realtime-канбаном, ограничениями WIP, автоматизациями и
              отчетами. Это каркас полной системы, дальше подключим модули.
            </p>
          </MotionDiv>
          <MotionDiv delay={0.2}>
            <div className="mt-8 flex gap-3 flex-wrap">
              <Link
                href="/app"
                className="inline-flex items-center justify-center rounded-full px-8 py-4 text-white font-semibold bg-gradient-to-r from-[#8A2BE2] to-[#4B0082] shadow-tech hover:scale-105 transition-all duration-300"
              >
                Открыть демо
              </Link>
              <Link
                href="#"
                className="inline-flex items-center justify-center rounded-full px-8 py-4 text-[#E0E0E0] font-semibold border border-[#2A2A2A] hover:border-[#3A3A3A] transition-all duration-300"
              >
                Документация API
              </Link>
            </div>
          </MotionDiv>
        </div>
        <div className="lg:col-span-5">
          <MotionDiv delay={0.25}>
            <div className="rounded-3xl border border-[#2A2A2A] bg-[#111111] p-6 shadow-lg">
              <div className="text-[#A0A0A0] text-sm">Стартовые модули</div>
              <ul className="mt-4 space-y-3">
                <li className="flex items-center gap-3 text-[#E0E0E0]">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#8A2BE2] box-shadow-tech" />
                  Kanban + realtime (подключим)
                </li>
                <li className="flex items-center gap-3 text-[#E0E0E0]">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#4B0082]" />
                  Ограничения WIP и запреты переходов
                </li>
                <li className="flex items-center gap-3 text-[#E0E0E0]">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#3B82F6]" />
                  Отчеты (CFD, lead/cycle, block time)
                </li>
              </ul>
              <div className="mt-6 text-[#A0A0A0]">
                Дальше реализуем auth, роли/доступы, automations, Scrum/Gantt,
                time tracking и Service Desk.
              </div>
            </div>
          </MotionDiv>
        </div>
      </div>
    </div>
  );
}

