"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";

import { authClient } from "@/lib/auth-client";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const requestedPath = searchParams.get("next");
  const nextPath = requestedPath?.startsWith("/") && !requestedPath.startsWith("//") ? requestedPath : "/workspace";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const { error: signInError } = await authClient.signIn.email({ email, password, callbackURL: nextPath });
    setIsSubmitting(false);

    if (signInError) {
      setError(signInError.message ?? "Unable to sign in with those details.");
      return;
    }

    router.replace(nextPath);
    router.refresh();
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#090908] p-5 text-[#fff6ea]">
      <section className="reveal w-full max-w-md border border-[#8e5a31]/70 bg-[#171512] p-6 shadow-[10px_11px_0_rgba(20,18,16,0.82)] sm:p-9">
        <Link className="font-[family-name:var(--font-display)] text-3xl tracking-[-0.04em] text-[#c97940]" href="/">BrickPilot</Link>
        <div className="mt-12">
          <p className="text-[0.72rem] font-bold uppercase tracking-[0.12em] text-[#c97940]">Studio access</p>
          <h1 className="mt-3 font-[family-name:var(--font-display)] text-5xl font-normal leading-none tracking-[-0.038em]">Return to the drafting table<span className="text-[#ff4e00]">.</span></h1>
          <p className="mt-4 max-w-sm text-sm leading-6 text-[#b5a697]">BrickPilot is invite-only. Sign in with a seeded project account.</p>
        </div>
        <form className="mt-9 space-y-5" onSubmit={handleSubmit}>
          <label className="block">
            <span className="text-[0.7rem] font-bold uppercase tracking-[0.12em] text-[#c97940]">Email</span>
            <input autoComplete="email" className="mt-2 w-full border border-[#8e5a31]/70 bg-[#090908] px-3 py-3 text-[#fff6ea] outline-none transition-colors focus:border-[#fff6ea]" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
          </label>
          <label className="block">
            <span className="text-[0.7rem] font-bold uppercase tracking-[0.12em] text-[#c97940]">Password</span>
            <input autoComplete="current-password" className="mt-2 w-full border border-[#8e5a31]/70 bg-[#090908] px-3 py-3 text-[#fff6ea] outline-none transition-colors focus:border-[#fff6ea]" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
          </label>
          {error ? <p className="border border-[#ff4e00] bg-[#ff4e00]/10 px-3 py-2 text-sm text-[#fff6ea]">{error}</p> : null}
          <button className="flex w-full items-center justify-between bg-[#ff4e00] px-4 py-3.5 text-xs font-bold uppercase tracking-[0.12em] text-[#fff6ea] transition hover:-translate-y-0.5 hover:bg-[#e94500] focus:outline-2 focus:outline-offset-4 focus:outline-[#fff6ea] disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transform-none" disabled={isSubmitting} type="submit">
            <span>{isSubmitting ? "Opening studio…" : "Enter studio"}</span>
            {isSubmitting ? <LockKeyhole className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
          </button>
        </form>
      </section>
    </main>
  );
}
