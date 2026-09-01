import { sql, query } from '@/lib/db';
import { iso, num } from '@/lib/mappers';
import type { Product, ProductStatus } from '@/types';

type Row = Record<string, unknown>;

function toProduct(r: Row): Product {
  return {
    id: String(r.id),
    code: String(r.code ?? ''),
    name: String(r.name),
    pack: String(r.pack ?? ''),
    brand: String(r.brand ?? ''),
    categorySlug: String(r.category_slug ?? ''),
    categoryTitle: String(r.category_title ?? ''),
    price: num(r.price),
    mrp: num(r.mrp),
    discountLabel: String(r.discount_label ?? ''),
    isPrescriptionOnly: Boolean(r.is_prescription_only),
    status: String(r.status).toUpperCase() === 'ACTIVE' ? 'active' : 'inactive',
    stockQuantity: num(r.stock_quantity),
    addedAt: iso(r.created_at) ?? new Date(0).toISOString(),
  };
}

export async function listProducts(): Promise<Product[]> {
  const rows = (await sql`
    SELECT p.id, p.code, p.name, p.pack, p.brand,
           c.slug  AS category_slug,
           c.title AS category_title,
           p.price, p.mrp, p.discount_label, p.is_prescription_only,
           p.status, p.stock_quantity, p.created_at
    FROM app.product p
    LEFT JOIN app.product_category c ON c.id = p.category_id
    ORDER BY p.name
  `) as Row[];
  return rows.map(toProduct);
}

export async function setProductStatus(id: string, status: ProductStatus): Promise<void> {
  await query('UPDATE app.product SET status = $2 WHERE id = $1', [
    id,
    status === 'active' ? 'ACTIVE' : 'INACTIVE',
  ]);
}

export async function updateProduct(
  id: string,
  patch: { price: number; stockQuantity: number },
): Promise<void> {
  await query(
    'UPDATE app.product SET price = $2, stock_quantity = $3 WHERE id = $1',
    [id, patch.price, patch.stockQuantity],
  );
}
