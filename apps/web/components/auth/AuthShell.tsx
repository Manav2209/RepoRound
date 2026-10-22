import type { ReactNode } from "react";

export function AuthShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="auth-page">
      <aside className="auth-aside">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
        <ul className="auth-points">
          <li>Questions grounded in real work</li>
          <li>Voice-first, pressure-on practice</li>
          <li>Feedback with quoted evidence</li>
        </ul>
      </aside>
      <section className="auth-panel">{children}</section>
    </main>
  );
}
