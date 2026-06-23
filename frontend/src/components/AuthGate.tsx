"use client";

import { useEffect, useState } from "react";
import { LogIn, ShieldCheck } from "lucide-react";

import {
  getSignedInUserLabel,
  isBrowserAuthEnabled,
  signIn,
} from "@/lib/auth";
import { friendlyError } from "@/lib/utils";

export default function AuthGate({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [isReady, setIsReady] = useState(!isBrowserAuthEnabled());
  const [userLabel, setUserLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!isBrowserAuthEnabled()) {
      setIsReady(true);
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        const label = await getSignedInUserLabel();
        if (cancelled) return;
        setUserLabel(label);
      } catch (err) {
        if (cancelled) return;
        setError(friendlyError(err, "Authentication failed."));
      } finally {
        if (!cancelled) setIsReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!isBrowserAuthEnabled()) {
    return <>{children}</>;
  }

  if (!isReady) {
    return (
      <div className="min-h-screen bg-app px-6 py-10 text-text-primary">
        <div className="mx-auto flex min-h-[70vh] max-w-lg items-center justify-center">
          <div className="w-full rounded-[2rem] border border-border-subtle bg-surface-1/80 p-10 text-center shadow-[0_24px_60px_rgba(0,0,0,0.1)] backdrop-blur-2xl">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-primary/20 text-brand-primary">
              <ShieldCheck size={24} />
            </div>
            <h1 className="mt-6 text-2xl font-bold uppercase tracking-[0.16em]">Checking Access</h1>
            <p className="mt-3 text-sm leading-relaxed text-text-muted">
              Validating your Microsoft sign-in before loading the workspace.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (userLabel) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-app px-6 py-10 text-text-primary">
      <div className="mx-auto flex min-h-[70vh] max-w-lg items-center justify-center">
        <div className="w-full rounded-[2rem] border border-border-subtle bg-surface-1/80 p-10 text-center shadow-[0_24px_60px_rgba(0,0,0,0.1)] backdrop-blur-2xl">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-primary/20 text-brand-primary">
            <ShieldCheck size={24} />
          </div>
          <h1 className="mt-6 text-2xl font-bold uppercase tracking-[0.16em]">Sign In Required</h1>
          <p className="mt-3 text-sm leading-relaxed text-text-muted">
            Use your Microsoft account to access the Azure-hosted workspace.
          </p>
          {error && (
            <p className="mt-4 rounded-2xl border border-brand-primary/30 bg-brand-primary/10 px-4 py-3 text-sm text-text-primary">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={() => {
              setError(null);
              void signIn().catch((err) => {
                setError(friendlyError(err, "Could not start sign-in."));
              });
            }}
            className="interactive-control mt-8 inline-flex items-center justify-center rounded-xl bg-brand-primary px-5 py-3 text-xs font-bold uppercase tracking-[0.18em] text-white shadow-[0_12px_32px_rgba(0,115,234,0.3)] transition hover:bg-brand-strong"
          >
            <LogIn size={14} strokeWidth={2.5} className="mr-2" />
            Sign In With Microsoft
          </button>
        </div>
      </div>
    </div>
  );
}
