"use client";

import { Suspense } from "react";
import PageImpl from "./page_impl_gray";

export default function AppPage() {
  return (
    <Suspense fallback={null}>
      <PageImpl />
    </Suspense>
  );
}

