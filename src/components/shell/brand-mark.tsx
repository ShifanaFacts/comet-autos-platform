/** Sidebar/drawer brand block. Height matches the top bar so the two rules line up. */
export function BrandMark({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground">
        C
      </span>
      {!collapsed ? (
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm leading-tight font-semibold tracking-tight">Comet Autos</span>
          <span className="truncate text-xs leading-tight text-sidebar-foreground/50">Workshop</span>
        </span>
      ) : null}
    </div>
  );
}
