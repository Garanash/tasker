import { redirect } from "next/navigation";

/** Сразу приложение и экран входа — без маркетингового лендинга. */
export default function HomePage() {
  redirect("/app");
}
