"use client";

import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main className="min-h-screen bg-[#0A0A0A] text-[#E0E0E0] flex items-center justify-center px-6">
      <div className="w-full max-w-2xl rounded-3xl border border-[#2A2A2A] bg-[#111111] p-10 shadow-2xl">
        <div className="text-xs uppercase tracking-[0.2em] text-[#A0A0A0] mb-2">Error</div>
        <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight bg-gradient-to-r from-white to-gray-500 bg-clip-text text-transparent">
          404
        </h1>
        <p className="mt-4 text-lg text-[#A0A0A0]">
          Страница или ручка не найдена. Проверьте URL и повторите попытку.
        </p>
        <div className="mt-8">
          <Link
            href="/app"
            className="inline-flex items-center rounded-full px-6 py-3 text-white font-semibold bg-gradient-to-r from-[#8A2BE2] to-[#4B0082] hover:scale-105 transition-all duration-300"
          >
            Вернуться в приложение
          </Link>
        </div>
      </div>
    </main>
  );
}
