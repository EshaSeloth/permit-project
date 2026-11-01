import { cn } from "@/lib/utils";

export function ProductNotes({ className }: { className?: string }) {
  return (
    <footer
      aria-labelledby="product-notes-title"
      className={cn("mt-12 border-t border-border pt-6 pb-6 text-center text-xs text-muted-foreground", className)}
    >
      <h2 id="product-notes-title" className="font-semibold">
        Product notes
      </h2>
      <p className="mt-1.5 leading-5">Made by Esha Seloth with the help of Claude.</p>
      <p className="mt-1 leading-5">
        All data here is generated and for sample use only. Inspired by Chargebee, where I was an intern.
      </p>
    </footer>
  );
}
