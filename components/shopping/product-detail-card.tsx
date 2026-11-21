"use client";

import { Check, ShoppingBag } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { useCart } from "@/components/cart-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Product } from "@/lib/types";

export type ProductDetail = {
  id: string;
  slug: string;
  name: string;
  category: string;
  price: string;
  priceCents: number;
  currency: string;
  url: string;
  description: string;
  images: string[];
  tags: string[];
  stock: { inStock: boolean; lowStock: boolean; quantity: number } | null;
};

function StockBadge({ stock }: { stock: ProductDetail["stock"] }) {
  if (!stock) return <Badge variant="outline">Stock unavailable</Badge>;
  if (!stock.inStock) return <Badge variant="destructive">Out of stock</Badge>;
  if (stock.lowStock) return <Badge variant="secondary">Only {stock.quantity} left</Badge>;
  return <Badge variant="secondary">In stock</Badge>;
}

/**
 * getProductDetails as a rich card: image gallery, price, live stock,
 * description and tags, plus Add to cart (using the storefront's cart) and a
 * link to the full product page.
 */
export function ProductDetailCard({ product }: { product: ProductDetail }) {
  const [active, setActive] = useState(0);
  const [added, setAdded] = useState(false);
  const { addToCart, openCart } = useCart();
  const image = product.images[active] ?? product.images[0];
  const canBuy = product.stock?.inStock ?? false;

  const handleAdd = () => {
    const cartProduct: Product = {
      id: product.id,
      slug: product.slug,
      name: product.name,
      description: product.description,
      price: product.priceCents,
      currency: product.currency,
      category: product.category,
      images: product.images,
      tags: product.tags,
      featured: false,
      createdAt: "",
    };
    addToCart(cartProduct, 1);
    setAdded(true);
  };

  return (
    <article
      aria-label={product.name}
      className="flex flex-col overflow-hidden rounded-lg border border-border bg-card"
    >
      <div className="relative aspect-[4/3] bg-secondary">
        {image ? (
          <Image
            src={image}
            alt={product.name}
            fill
            sizes="(min-width: 768px) 360px, 90vw"
            className="object-cover"
          />
        ) : null}
      </div>
      {product.images.length > 1 && (
        <div className="flex gap-2 px-3 pt-3" role="group" aria-label="Product images">
          {product.images.map((src, i) => (
            <button
              key={src}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`Show image ${i + 1} of ${product.images.length}`}
              aria-pressed={i === active}
              className="relative size-12 overflow-hidden rounded border border-border aria-pressed:border-foreground"
            >
              <Image src={src} alt="" fill sizes="48px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-3 p-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold leading-snug text-foreground">{product.name}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{product.price}</span>
            <StockBadge stock={product.stock} />
          </div>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{product.description}</p>
        {product.tags.length > 0 && (
          <ul className="flex flex-wrap gap-1" aria-label="Tags">
            {product.tags.map((t) => (
              <li key={t}>
                <Badge variant="outline" className="font-normal">
                  {t}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={added ? openCart : handleAdd}
            disabled={!canBuy}
            aria-label={
              !canBuy
                ? `${product.name} is out of stock`
                : added
                  ? "Added. View cart"
                  : `Add ${product.name} to cart`
            }
          >
            {added ? <Check aria-hidden="true" /> : <ShoppingBag aria-hidden="true" />}
            {!canBuy ? "Out of stock" : added ? "View cart" : "Add to cart"}
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link href={product.url}>View product page</Link>
          </Button>
        </div>
      </div>
    </article>
  );
}
