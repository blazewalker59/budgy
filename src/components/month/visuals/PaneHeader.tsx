/** The line under the carousel's tabs: what a visual shows, and its headline. */
export function PaneHeader({
  hint,
  children,
}: {
  hint?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    // A phone stacks them; side by side once there's room.
    <div className="mb-2 flex flex-col gap-0.5 text-[13px] text-muted sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between sm:gap-x-3">
      <span className="text-xs sm:text-[13px]">{hint}</span>
      {children && <div>{children}</div>}
    </div>
  )
}
