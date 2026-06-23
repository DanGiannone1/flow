"use client";

import { createContext, useContext } from "react";
import { useAgentSession } from "@/hooks/useAgentSession";

// One continuous agent session shared across both assistant surfaces (the docked
// co-pilot on the host app route and the dedicated /assistant workspace). Lifting it
// into context — above the routes — is what makes the session continuous: navigating
// between surfaces never resets the conversation or loses workspace state.
type SessionValue = ReturnType<typeof useAgentSession>;

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const session = useAgentSession();
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within a SessionProvider");
  return ctx;
}
