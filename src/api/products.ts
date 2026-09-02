import { sql, query } from '@/lib/db';
import { iso, num } from '@/lib/mappers';
import type { NewProduct, Product, ProductCategory, ProductStatus } from '@/types';

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
    image: String(r.image ?? ''),
    addedAt: iso(r.created_at) ?? new Date(0).toISOString(),
  };
}

export async function listProducts(): Promise<Product[]> {
  const rows = (await sql`
    SELECT p.id, p.code, p.name, p.pack, p.brand,
           c.slug  AS category_slug,
           c.title AS category_title,
           p.price, p.mrp, p.discount_label, p.is_prescription_only,
           p.status, p.stock_quantity, p.image, p.created_at
    FROM app.product p
    LEFT JOIN app.product_category c ON c.id = p.category_id
    ORDER BY p.name
  `) as Row[];
  return rows.map(toProduct);
}

/** The storefront category groups the admin picks from when adding a product. */
export async function listCategories(): Promise<ProductCategory[]> {
  const rows = (await sql`
    SELECT id, slug, title
    FROM app.product_category
    WHERE is_active
    ORDER BY sort, title
  `) as Row[];
  return rows.map((r) => ({
    id: String(r.id),
    slug: String(r.slug),
    title: String(r.title),
  }));
}

/**
 * Adds a product to the catalogue under the chosen category. Available to the
 * app and the web console the moment it is written. Returns the new id.
 */
export async function createProduct(p: NewProduct): Promise<string> {
  const rows = await query<Row>(
    `
    INSERT INTO app.product
      (name, pack, brand, category_id, price, mrp, discount_label,
       is_prescription_only, status, stock_quantity, code, image)
    VALUES
      ($1, $2, $3,
       (SELECT id FROM app.product_category WHERE slug = $4),
       $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING id
    `,
    [
      p.name.trim(),
      p.pack.trim(),
      p.brand.trim(),
      p.categorySlug,
      p.price,
      p.mrp,
      p.discountLabel.trim(),
      p.isPrescriptionOnly,
      p.status === 'active' ? 'ACTIVE' : 'INACTIVE',
      p.stockQuantity,
      p.code.trim() || null,
      p.image || null,
    ],
  );
  return String(rows[0].id);
}

/** Removes a product from the catalogue. Order lines keep their text copy. */
export async function deleteProduct(id: string): Promise<void> {
  await query('DELETE FROM app.product WHERE id = $1', [id]);
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
