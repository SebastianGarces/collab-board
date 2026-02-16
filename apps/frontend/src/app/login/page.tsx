"use client";

import { useRouter } from "next/navigation";
import { SubmitEventHandler, useEffect, useState } from "react";

import { authClient } from "@/lib/auth-client";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: session, isPending } = authClient.useSession();

  const title = mode === "signin" ? "Sign in" : "Create account";

  useEffect(() => {
    if (!isPending && session?.user) {
      router.replace("/canvas/main");
    }
  }, [isPending, session, router]);

  const onSubmit: SubmitEventHandler<HTMLFormElement>  = async (event) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      if (mode === "signup") {
        const result = await authClient.signUp.email({
          email,
          password,
          name
        });

        if (result.error) {
          setError(result.error.message ?? "Unable to create account.");
        }
      } else {
        const result = await authClient.signIn.email({
          email,
          password
        });

        if (result.error) {
          setError(result.error.message ?? "Unable to sign in.");
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isPending && session?.user) {
    return null;
  }

  return (
    <main className="min-h-screen grid place-content-center p-4">
      <section className="w-full max-w-[420px] p-6 border border-[#303e61] rounded-xl bg-[#131b33]">
        <h1 className="m-0 mb-2">{title}</h1>
        <p className="mt-0 text-[#b9c6ef]">Use email/password auth managed by Better Auth.</p>

        <form onSubmit={onSubmit} className="grid gap-3.5">
          {mode === "signup" ? (
            <label className="grid gap-1.5 text-[0.94rem]">
              Name
              <input
                className="w-full px-3 py-2.5 rounded-lg border border-[#3b4b73] bg-[#0f1730] text-[#f2f5ff]"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </label>
          ) : null}

          <label className="grid gap-1.5 text-[0.94rem]">
            Email
            <input
              type="email"
              autoComplete="email"
              className="w-full px-3 py-2.5 rounded-lg border border-[#3b4b73] bg-[#0f1730] text-[#f2f5ff]"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>

          <label className="grid gap-1.5 text-[0.94rem]">
            Password
            <input
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              className="w-full px-3 py-2.5 rounded-lg border border-[#3b4b73] bg-[#0f1730] text-[#f2f5ff]"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>

          {error ? <p className="m-0 text-[#ff9da0]">{error}</p> : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-1 border-0 rounded-lg px-3 py-2.5 bg-[#3f7fff] text-white cursor-pointer font-inherit disabled:opacity-50"
          >
            {isSubmitting ? "Please wait..." : title}
          </button>
        </form>

        <div className="mt-3.5 flex items-center justify-between gap-3">
          <button
            type="button"
            className="border-0 bg-transparent text-[#9cc7ff] p-0 cursor-pointer"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin" ? "Need an account?" : "Already have an account?"}
          </button>
        </div>
      </section>
    </main>
  );
}
