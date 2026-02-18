import { Kbd, KbdGroup } from "@/components/ui/kbd";

export default function CanvasLoading() {
  return (
    <main className="min-h-screen grid grid-rows-[auto_1fr_auto]">
      <header className="px-4 py-3 border-b border-[#2a2a2a] bg-[#1a1a1a] flex justify-between items-center gap-4">
        <div>
          <strong>Loading...</strong>
        </div>
      </header>
      <section className="relative overflow-hidden bg-[#121212] bg-[radial-gradient(circle,rgba(255,255,255,0.1)_1px,transparent_1px)] bg-[length:24px_24px] touch-none" />
      <footer className="px-4 py-2.5 border-t border-[#2a2a2a] bg-[#1a1a1a] text-[#999] text-sm">
        Hold <KbdGroup><Kbd>⇧</Kbd><Kbd>drag</Kbd></KbdGroup> or middle-mouse drag to pan. Scroll to zoom.
      </footer>
    </main>
  );
}
