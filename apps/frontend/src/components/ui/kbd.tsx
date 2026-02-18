import { cn } from "@/lib/utils"

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex items-center justify-center gap-0.5 rounded border border-[#3a3a3a] border-b-2 bg-[#242424] px-1.5 py-0.5 font-mono text-xs font-medium text-[#999]",
        className
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <span
      className={cn("inline-flex items-center gap-0.5", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
