import Image from "next/image";
import Link from "next/link";

import type { ProductSummary } from "@/lib/tools";

/**
 * searchProducts results as browsable cards: image, name, formatted price
 * and a link to the existing product page. Two columns fit the chat panel on
 * desktop and phones; long result sets scroll with the conversation.
 */
export function ProductResults({
  products,
  query,
  category,
}: {
  products: ProductSummary[];
  query: string | null;
  category: string | null;
}) {
  const label = query ? `Results for “${query}”` : category ? `Category: ${category}` : "Catalog";

  if (products.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        No products matched{query ? ` “${query}”` : ""}. Try a broader search or another category.
      </p>
    );
  }

  return (
    <section aria-label={`${label}: ${products.length} products`} className="flex flex-col gap-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label} · {products.length} {products.length === 1 ? "product" : "products"}
      </p>
      <ul className="grid grid-cols-2 gap-2">
        {products.map((p) => (
          <li key={p.id}>
            <Link
              href={p.url}
              className="group block overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-foreground/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <div className="relative aspect-square overflow-hidden bg-secondary">
                {p.image ? (
                  <Image
                    src={p.image}
                    alt={p.name}
                    fill
                    sizes="(min-width: 768px) 180px, 45vw"
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                ) : null}
              </div>
              <div className="p-2">
                <p className="line-clamp-2 text-xs font-medium text-foreground">{p.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{p.price}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
