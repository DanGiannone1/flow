"use client";

import { useRouter } from "next/navigation";
import { LayoutDashboard, FileText, Files, Sparkles } from "lucide-react";
import { AppState } from "@/lib/types";

// The Tax Workbench left-nav rail, shared by the host app and the Assistant workspace so
// the workspace reads as a page *of* Tax Workbench (not a separate chatbot). Host items
// navigate the app (onNavigate → viewRoute); the ✦ Assistant item routes to /assistant.
export default function WorkbenchNav({
  viewRoute, onNavigate, assistantActive = false,
}: {
  appState: AppState | null;
  viewRoute: string;
  onNavigate: (route: string) => void;
  assistantActive?: boolean;
}) {
  const router = useRouter();

  const navItem = (route: string, label: string, Icon: typeof FileText) => {
    const active = !assistantActive && (viewRoute === route || (route !== "/dashboard" && viewRoute.startsWith(route)));
    return (
      <button type="button" onClick={() => onNavigate(route)} className={`tw-nav-item ${active ? "tw-nav-item-active" : ""}`} data-testid={`nav-${route.replace(/\//g, "-")}`}>
        <Icon size={16} strokeWidth={2.25} />
        <span>{label}</span>
      </button>
    );
  };

  return (
    <nav className="tw-nav">
      {navItem("/dashboard", "Dashboard", LayoutDashboard)}
      <div className="tw-nav-section">Workspace</div>
      {navItem("/filings", "Filings", FileText)}
      {navItem("/documents", "Documents", Files)}
      <div className="tw-nav-section">Assistant</div>
      <button
        type="button"
        data-testid="nav-assistant"
        onClick={() => router.push("/assistant")}
        className={`tw-nav-item ${assistantActive ? "tw-nav-item-active" : ""}`}
      >
        <Sparkles size={16} strokeWidth={2.25} />
        <span>Assistant workspace</span>
      </button>
    </nav>
  );
}
