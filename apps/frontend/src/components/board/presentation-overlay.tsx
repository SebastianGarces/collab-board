"use client";

import { ArrowLeft, ArrowRight, Presentation, X } from "lucide-react";
import { useCallback, useEffect } from "react";

type PresentationOverlayProps = {
  slides: string[];
  currentSlide: number;
  onNext: () => void;
  onPrev: () => void;
  onExit: () => void;
  isFollowing: boolean;
  presenterName?: string;
  onReattach?: () => void;
  onStopFollowing?: () => void;
  presentationEnded?: boolean;
};

export function PresentationOverlay({
  slides,
  currentSlide,
  onNext,
  onPrev,
  onExit,
  isFollowing,
  presenterName,
  onReattach,
  onStopFollowing,
  presentationEnded = false,
}: PresentationOverlayProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onExit();
        return;
      }
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        onNext();
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        onPrev();
      }
    },
    [onExit, onNext, onPrev]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const slideCount = slides.length;
  const displayIndex = slideCount > 0 ? ((currentSlide % slideCount) + slideCount) % slideCount : 0;

  return (
    <div className="absolute inset-0 z-50 pointer-events-none">
      {/* Vignette */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.4) 100%)`,
        }}
      />

      {/* Top banner: Presentation ended or Following */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 pointer-events-auto">
        {presentationEnded ? (
          <div className="px-4 py-2 rounded-lg bg-[#2a2a2a]/90 border border-[#3a3a3a] text-sm text-[#999]">
            Presentation ended
          </div>
        ) : isFollowing && presenterName ? (
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#2a2a2a]/90 border border-[#3a3a3a]">
            <span className="text-sm text-[#999]">Following {presenterName}</span>
            <button
              type="button"
              onClick={onStopFollowing}
              className="cursor-pointer text-xs text-[#60a5fa] hover:text-[#93bbfc]"
            >
              Stop following
            </button>
          </div>
        ) : onReattach && presenterName ? (
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#2a2a2a]/90 border border-[#3a3a3a]">
            <span className="text-sm text-[#999]">Not following</span>
            <button
              type="button"
              onClick={onReattach}
              className="cursor-pointer text-xs text-[#60a5fa] hover:text-[#93bbfc]"
            >
              Follow {presenterName}
            </button>
          </div>
        ) : null}
      </div>

      {/* Exit button */}
      <div className="absolute top-4 right-4 z-10 pointer-events-auto">
        <button
          type="button"
          onClick={onExit}
          className="flex cursor-pointer items-center gap-2 px-3 py-2 rounded-lg bg-[#2a2a2a]/70 text-[#999] hover:bg-[#3a3a3a] hover:text-white transition-opacity opacity-70 hover:opacity-100"
        >
          <X className="h-4 w-4" />
          Exit
        </button>
      </div>

      {/* Left arrow */}
      <div className="absolute left-4 top-1/2 -translate-y-1/2 z-10 pointer-events-auto">
        <button
          type="button"
          onClick={onPrev}
          className="flex cursor-pointer items-center justify-center w-12 h-12 rounded-full bg-[#2a2a2a]/70 text-[#999] hover:bg-[#3a3a3a] hover:text-white transition-opacity opacity-70 hover:opacity-100"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
      </div>

      {/* Right arrow */}
      <div className="absolute right-4 top-1/2 -translate-y-1/2 z-10 pointer-events-auto">
        <button
          type="button"
          onClick={onNext}
          className="flex cursor-pointer items-center justify-center w-12 h-12 rounded-full bg-[#2a2a2a]/70 text-[#999] hover:bg-[#3a3a3a] hover:text-white transition-opacity opacity-70 hover:opacity-100"
        >
          <ArrowRight className="h-6 w-6" />
        </button>
      </div>

      {/* Slide counter */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 pointer-events-auto">
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#2a2a2a]/70 text-sm text-[#999] opacity-70">
          <Presentation className="h-4 w-4" />
          {slideCount > 0 ? (
            <span>
              {displayIndex + 1} / {slideCount}
            </span>
          ) : (
            <span>0 / 0</span>
          )}
        </div>
      </div>
    </div>
  );
}
