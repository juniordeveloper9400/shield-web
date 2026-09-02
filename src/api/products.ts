import { sql, query } from '@/lib/db';
import { iso, num } from '@/lib/mappers';
import type {
  NewProduct,
  Product,
  ProductCategory,
  ProductDetailInput,
  ProductFaqInput,
  ProductStatus,
  ProductSubcategory,
} from '@/types';

type Row = Record<string, unknown>;

/** Splits a textarea into trimmed, non-empty lines for a `text[]` column. */
function lines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** True when the admin entered nothing in the detail block — skip the writes. */
function detailIsBlank(d: ProductDetailInput): boolean {
  return (
    !d.form.trim() &&
    !d.manufacturer.trim() &&
    !d.description.trim() &&
    !d.ingredients.trim() &&
    !d.storage.trim() &&
    !d.highlights.trim() &&
    !d.benefits.trim() &&
    !d.directions.trim() &&
    !d.safety.trim() &&
    d.faqs.every((f) => !f.question.trim() && !f.answer.trim())
  );
}

/** Writes `app.product_detail` + `app.product_faq` for a product id. */
async function writeProductDetail(
  productId: string,
  d: ProductDetailInput,
): Promise<void> {
  await query(
    `
    INSERT INTO app.product_detail
      (product_id, form, manufacturer, description, ingredients, storage,
       highlights, benefits, directions, safety)
    VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8::text[], $9::text[], $10::text[])
    ON CONFLICT (product_id) DO UPDATE SET
      form = EXCLUDED.form,
      manufacturer = EXCLUDED.manufacturer,
      description = EXCLUDED.description,
      ingredients = EXCLUDED.ingredients,
      storage = EXCLUDED.storage,
      highlights = EXCLUDED.highlights,
      benefits = EXCLUDED.benefits,
      directions = EXCLUDED.directions,
      safety = EXCLUDED.safety,
      updated_at = now()
    `,
    [
      productId,
      d.form.trim(),
      d.manufacturer.trim(),
      d.description.trim(),
      d.ingredients.trim(),
      d.storage.trim(),
      lines(d.highlights),
      lines(d.benefits),
      lines(d.directions),
      lines(d.safety),
    ],
  );

  const faqs = d.faqs.filter((f) => f.question.trim() && f.answer.trim());
  await query('DELETE FROM app.product_faq WHERE product_id = $1', [productId]);
  for (let i = 0; i < faqs.length; i += 1) {
    await query(
      `INSERT INTO app.product_faq (product_id, question, answer, sort)
       VALUES ($1, $2, $3, $4)`,
      [productId, faqs[i].question.trim(), faqs[i].answer.trim(), i],
    );
  }
}

function toProduct(r: Row): Product {
  return {
    id: String(r.id),
    code: String(r.code ?? ''),
    name: String(r.name),
    pack: String(r.pack ?? ''),
    brand: String(r.brand ?? ''),
    categorySlug: String(r.category_slug ?? ''),
    categoryTitle: String(r.category_title ?? ''),
    subcategoryId: r.subcategory_id == null ? '' : String(r.subcategory_id),
    subcategoryLabel: String(r.subcategory_label ?? ''),
    price: num(r.price),
    mrp: num(r.mrp),
    discountLabel: String(r.discount_label ?? ''),
    isPrescriptionOnly: Boolean(r.is_prescription_only),
    status: String(r.status).toUpperCase() === 'ACTIVE' ? 'active' : 'inactive',
    stockQuantity: num(r.stock_quantity),
    image: String(r.image ?? ''),
    isPopular: r.is_popular === true,
    isDeal: r.is_deal === true,
    isOfferOfDay: r.is_offer_of_day === true,
    addedAt: iso(r.created_at) ?? new Date(0).toISOString(),
  };
}

export async function listProducts(): Promise<Product[]> {
  const rows = (await sql`
    SELECT p.id, p.code, p.name, p.pack, p.brand,
           c.slug  AS category_slug,
           c.title AS category_title,
           s.id    AS subcategory_id,
           s.label AS subcategory_label,
           p.price, p.mrp, p.discount_label, p.is_prescription_only,
           p.status, p.stock_quantity, p.image,
           p.is_popular, p.is_deal, p.is_offer_of_day, p.created_at
    FROM app.product p
    LEFT JOIN app.product_category    c ON c.id = p.category_id
    LEFT JOIN app.product_subcategory s ON s.id = p.subcategory_id
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
 * Every sub-category, with its parent category's slug — the second dropdown on
 * the "Add product" form filters this list by the chosen category. Seeded to
 * match the app's category browser by migration 0004.
 */
export async function listSubcategories(): Promise<ProductSubcategory[]> {
  const rows = (await sql`
    SELECT s.id, s.label, c.slug AS category_slug
    FROM app.product_subcategory s
    JOIN app.product_category c ON c.id = s.category_id
    WHERE c.is_active
    ORDER BY c.sort, s.sort, s.label
  `) as Row[];
  return rows.map((r) => ({
    id: String(r.id),
    categorySlug: String(r.category_slug),
    label: String(r.label),
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
      (name, pack, brand, category_id, subcategory_id, price, mrp,
       discount_label, is_prescription_only, status, stock_quantity, code, image,
       is_popular, is_deal, is_offer_of_day)
    VALUES
      ($1, $2, $3,
       (SELECT id FROM app.product_category WHERE slug = $4),
       $5::bigint,
       $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    RETURNING id
    `,
    [
      p.name.trim(),
      p.pack.trim(),
      p.brand.trim(),
      p.categorySlug,
      p.subcategoryId || null,
      p.price,
      p.mrp,
      p.discountLabel.trim(),
      p.isPrescriptionOnly,
      p.status === 'active' ? 'ACTIVE' : 'INACTIVE',
      p.stockQuantity,
      p.code.trim() || null,
      p.image || null,
      p.isPopular,
      p.isDeal,
      p.isOfferOfDay,
    ],
  );
  const id = String(rows[0].id);

  // The detail page + FAQs, when the admin filled any of that block in. A
  // failure here should not lose the product that was just created, so it is
  // reported but not rethrown past the returned id.
  if (!detailIsBlank(p.detail)) {
    try {
      await writeProductDetail(id, p.detail);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Product created, but its detail page failed to save:', err);
    }
  }

  return id;
}

/**
 * The detail-page content for a product, or `null` when none has been entered.
 * The list columns come back as JS arrays from the driver.
 */
export async function getProductDetail(
  id: string,
): Promise<(ProductDetailInput & { hasDetail: boolean }) | null> {
  const rows = (await query<Row>(
    `
    SELECT d.form, d.manufacturer, d.description, d.ingredients, d.storage,
           d.highlights, d.benefits, d.directions, d.safety,
           COALESCE((
             SELECT json_agg(json_build_object('question', f.question, 'answer', f.answer)
                             ORDER BY f.sort, f.id)
             FROM app.product_faq f WHERE f.product_id = p.id
           ), '[]') AS faqs
    FROM app.product p
    LEFT JOIN app.product_detail d ON d.product_id = p.id
    WHERE p.id = $1
    LIMIT 1
    `,
    [id],
  )) as Row[];
  if (rows.length === 0) return null;
  const r = rows[0];
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? (v as unknown[]).map(String) : [];
  const rawFaqs = r.faqs;
  const faqs: ProductFaqInput[] = Array.isArray(rawFaqs)
    ? (rawFaqs as ProductFaqInput[])
    : typeof rawFaqs === 'string'
      ? (JSON.parse(rawFaqs) as ProductFaqInput[])
      : [];
  const hasDetail =
    r.form != null ||
    r.manufacturer != null ||
    Boolean(r.description) ||
    faqs.length > 0;
  return {
    form: String(r.form ?? ''),
    manufacturer: String(r.manufacturer ?? ''),
    description: String(r.description ?? ''),
    ingredients: String(r.ingredients ?? ''),
    storage: String(r.storage ?? ''),
    highlights: arr(r.highlights).join('\n'),
    benefits: arr(r.benefits).join('\n'),
    directions: arr(r.directions).join('\n'),
    safety: arr(r.safety).join('\n'),
    faqs,
    hasDetail,
  };
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

/**
 * Sets which home-feed rows a product appears in — "Popular Items",
 * "Deals You Love", "Offer of the Day". The app picks the change up on its
 * next catalogue load.
 */
export async function updateProductSections(
  id: string,
  sections: { isPopular: boolean; isDeal: boolean; isOfferOfDay: boolean },
): Promise<void> {
  await query(
    `UPDATE app.product
        SET is_popular = $2, is_deal = $3, is_offer_of_day = $4
      WHERE id = $1`,
    [id, sections.isPopular, sections.isDeal, sections.isOfferOfDay],
  );
}
