"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="min-h-screen grid place-content-center">
      <section className="text-center">
        <h2>Something went wrong</h2>
        <p className="text-muted-foreground mb-4">
          {error.message || "An unexpected error occurred."}
        </p>
        <button
          type="button"
          onClick={reset}
          className="border border-[#3a3a3a] rounded-lg px-4 py-2 bg-[#242424] text-inherit cursor-pointer"
        >
          Try again
        </button>
      </section>
    </main>
  );
}
