import { ROBOT_PATTERN, decodeHtml, hasVeganClaim, isObject, isOrganic, parsePrice, str, stripTags, type Adapter, type MutationInput, type SessionSignals } from "./adapter.js";
import { ContractChangedError } from "./errors.js";
import type { CartInput, ProductInput, SummaryInput } from "./types.js";

export interface WooCommerceOptions {
  origin: string;
  hosts: string[];
  /** Chemin des fiches produit, par exemple /produit/. */
  productPathPrefix: string;
}

/** Fonctions JavaScript exécutées dans la page officielle : API Store de WooCommerce avec le nonce de la session. */
const PRELUDE = String.raw`
const clean = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim();
const storeApi = (path) => location.origin + "/wp-json/wc/store/v1" + path;
const money = (value, minor) => value == null || value === "" ? null : Number(value) / Math.pow(10, minor == null ? 2 : minor);
let nonce = null;
const readCart = async () => {
  const response = await fetch(storeApi("/cart"), { credentials: "include" });
  if (!response.ok) throw new Error("Panier HTTP " + response.status);
  nonce = response.headers.get("nonce") || response.headers.get("x-wc-store-api-nonce") || nonce;
  const cart = await response.json();
  if (!cart || !Array.isArray(cart.items) || !cart.totals) throw new Error("Contrat Store API panier absent");
  const minor = cart.totals.currency_minor_unit;
  return {
    currency_minor_unit: minor,
    total_price: cart.totals.total_items,
    items: cart.items.map((item) => ({
      key: item.key, id: item.id, name: item.name, quantity: item.quantity,
      price: item.prices && item.prices.price, line_total: item.totals && item.totals.line_total,
      sku: item.sku || null,
      maximum: item.quantity_limits && item.quantity_limits.maximum != null ? item.quantity_limits.maximum : null,
    })),
  };
};
const write = async (path, body) => {
  if (!nonce) await readCart();
  const response = await fetch(storeApi(path), { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", Nonce: nonce }, body: JSON.stringify(body) });
  nonce = response.headers.get("nonce") || response.headers.get("x-wc-store-api-nonce") || nonce;
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("Panier refusé (" + response.status + ") : " + clean(json.message || json.code || "").slice(0, 200));
  return json;
};
`;

function searchExpression(query: string, limit: number): string {
  return `(async () => {
    ${PRELUDE}
    const url = storeApi("/products") + "?search=" + encodeURIComponent(${JSON.stringify(query)}) + "&per_page=" + ${limit};
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) throw new Error("Recherche HTTP " + response.status);
    const products = await response.json();
    if (!Array.isArray(products)) throw new Error("Contrat Store API produits absent");
    return products.map((p) => ({
      id: p.id, name: p.name, permalink: p.permalink, sku: p.sku, type: p.type,
      price: p.prices && p.prices.price, regular_price: p.prices && p.prices.regular_price, minor: p.prices && p.prices.currency_minor_unit,
      in_stock: p.is_in_stock, purchasable: p.is_purchasable, has_options: p.has_options, low_stock: p.low_stock_remaining,
      brands: Array.isArray(p.brands) ? p.brands.map((b) => b.name) : [],
      categories: Array.isArray(p.categories) ? p.categories.map((c) => c.name) : [],
      attributes: Array.isArray(p.attributes) ? p.attributes.map((a) => ({ name: a.name, terms: Array.isArray(a.terms) ? a.terms.map((t) => t.name) : [] })) : [],
    }));
  })()`;
}

function productExpression(productUrl: string): string {
  return `(async () => {
    ${PRELUDE}
    const target = new URL(${JSON.stringify(productUrl)});
    const slug = target.pathname.split("/").filter(Boolean).pop();
    const apiResponse = await fetch(storeApi("/products") + "?slug=" + encodeURIComponent(slug), { credentials: "include" });
    if (!apiResponse.ok) throw new Error("Fiche API HTTP " + apiResponse.status);
    const list = await apiResponse.json();
    const p = Array.isArray(list) ? list[0] : null;
    if (!p) throw new Error("Produit introuvable pour " + slug);
    const page = await fetch(target.toString(), { credentials: "include" });
    let gtin = null, ingredients = null;
    const nutrition = [];
    if (page.ok) {
      const doc = new DOMParser().parseFromString(await page.text(), "text/html");
      for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const json = JSON.parse(script.textContent);
          const found = (json["@graph"] || [json]).find((entry) => entry && entry["@type"] === "Product");
          if (found) { gtin = found.gtin13 || found.gtin || found.gtin14 || found.gtin8 || null; break; }
        } catch (error) { /* bloc non exploitable */ }
      }
      for (const element of Array.prototype.slice.call(doc.querySelectorAll("strong, b, h2, h3, h4, h5, p, li, span, div")).reverse()) {
        const text = clean(element.textContent);
        if (/^ingr[ée]dients?\\b\\s*[:\\-]\\s*\\S/i.test(text) && text.length < 4000 && element.children.length < 8) { ingredients = text.replace(/^ingr[ée]dients?\\b\\s*[:\\-]\\s*/i, ""); break; }
        if (/^ingr[ée]dients?\\s*:?$/i.test(text) && element.parentElement) {
          const sibling = element.nextElementSibling ? clean(element.nextElementSibling.textContent) : "";
          const inherited = clean(element.parentElement.textContent).replace(/^ingr[ée]dients?\\s*:?\\s*/i, "");
          const candidate = sibling || inherited;
          if (candidate && candidate.length < 4000) { ingredients = candidate; break; }
        }
      }
      for (const table of doc.querySelectorAll("table")) {
        if (!/[ée]nergie|energy|kcal|prot[ée]ines|glucides/i.test(table.textContent)) continue;
        for (const row of table.querySelectorAll("tr")) {
          const cells = Array.prototype.map.call(row.querySelectorAll("th, td"), (cell) => clean(cell.textContent));
          if (cells.length >= 2 && cells[0] && cells[1]) nutrition.push({ label: cells[0], value: cells[1] });
        }
        if (nutrition.length) break;
      }
    }
    return {
      id: p.id, name: p.name, permalink: p.permalink, sku: p.sku, type: p.type,
      price: p.prices && p.prices.price, minor: p.prices && p.prices.currency_minor_unit,
      in_stock: p.is_in_stock, purchasable: p.is_purchasable, has_options: p.has_options, low_stock: p.low_stock_remaining,
      brands: Array.isArray(p.brands) ? p.brands.map((b) => b.name) : [],
      short_description: p.short_description || "", description: p.description || "",
      attributes: Array.isArray(p.attributes) ? p.attributes.map((a) => ({ name: a.name, terms: Array.isArray(a.terms) ? a.terms.map((t) => t.name) : [] })) : [],
      gtin: gtin, ingredients: ingredients, nutrition: nutrition,
    };
  })()`;
}

function cartExpression(): string {
  return `(async () => { ${PRELUDE} return readCart(); })()`;
}

function mutationExpression(input: MutationInput): string {
  return `(async () => {
    ${PRELUDE}
    const productId = Number(${JSON.stringify(input.productId)});
    const target = ${input.targetQuantity};
    const before = await readCart();
    const line = before.items.find((item) => Number(item.id) === productId);
    const current = line ? Number(line.quantity) : 0;
    if (current === target) return { before, after: before, applied: false };
    if (target === 0) await write("/cart/remove-item", { key: line.key });
    else if (!line) await write("/cart/add-item", { id: productId, quantity: target });
    else await write("/cart/update-item", { key: line.key, quantity: target });
    return { before, after: await readCart(), applied: true };
  })()`;
}

function minorToNumber(value: unknown, minor: unknown): number | null {
  const amount = parsePrice(value);
  const digits = typeof minor === "number" && Number.isInteger(minor) ? minor : 2;
  return amount === null ? null : amount / 10 ** digits;
}

export function createWooCommerceAdapter(options: WooCommerceOptions): Adapter {
  const hosts = new Set(options.hosts);
  const inHosts = (url: URL): boolean => url.protocol === "https:" && hosts.has(url.hostname);
  return {
    entryUrl: () => `${options.origin}/`,
    matchesTab: (url) => inHosts(url),
    inspectSession({ snapshot, tabUrl }): SessionSignals {
      let onSite = false;
      try { onSite = inHosts(new URL(tabUrl)); } catch { onSite = false; }
      const robotVisible = ROBOT_PATTERN.test(snapshot);
      return { ready: onSite && !robotVisible && snapshot.trim().length > 0, robotVisible, accountConnected: /d[ée]connexion|se d[ée]connecter|log ?out/i.test(snapshot) };
    },
    validateProductUrl(url) {
      if (!inHosts(url) || !url.pathname.startsWith(options.productPathPrefix)) throw new Error("Hors des fiches produit du site officiel.");
    },
    searchExpression: (_config, query, limit) => searchExpression(query, limit),
    normalizeSearch(raw): SummaryInput[] {
      if (!Array.isArray(raw)) throw new ContractChangedError("La recherche n’a pas retourné une liste de produits.");
      return raw.map((entry): SummaryInput => {
        if (!isObject(entry)) throw new ContractChangedError("Un produit n’est plus un objet exploitable.");
        const id = str(entry, "id");
        const name = str(entry, "name");
        const price = minorToNumber(entry.price, entry.minor);
        const url = str(entry, "permalink");
        if (!id || !name || price === null || !url || typeof entry.in_stock !== "boolean") throw new ContractChangedError("Un produit ne contient plus son identifiant, son nom, son prix, son URL ou son stock.");
        const attributes = Array.isArray(entry.attributes) ? entry.attributes.flatMap((attribute) => isObject(attribute) ? [`${str(attribute, "name") ?? ""} ${Array.isArray(attribute.terms) ? attribute.terms.join(" ") : ""}`] : []) : [];
        const brands = Array.isArray(entry.brands) ? entry.brands.map(String) : [];
        const low = typeof entry.low_stock === "number" && Number.isInteger(entry.low_stock) && entry.low_stock >= 0 ? entry.low_stock : null;
        return {
          product_id: id, name: decodeHtml(name), brand: brands[0] ? decodeHtml(brands[0]) : null, price,
          unit_price: null,
          availability: entry.in_stock && entry.purchasable !== false ? "available" : "out_of_stock",
          available_quantity: low, organic: isOrganic(`${name} ${attributes.join(" ")}`), product_url: url,
        };
      });
    },
    productExpression: (_config, productUrl) => productExpression(productUrl),
    normalizeProduct(raw, _config, requestedUrl): ProductInput {
      if (!isObject(raw)) throw new ContractChangedError("La fiche n’a pas retourné l’objet produit attendu.");
      const id = str(raw, "id");
      const name = str(raw, "name");
      const price = minorToNumber(raw.price, raw.minor);
      if (!id || !name || price === null || typeof raw.in_stock !== "boolean") throw new ContractChangedError("La fiche ne contient plus son identifiant, son nom, son prix ou son stock.");
      const brands = Array.isArray(raw.brands) ? raw.brands.map(String) : [];
      const description = stripTags(`${str(raw, "short_description") ?? ""} ${str(raw, "description") ?? ""}`);
      const low = typeof raw.low_stock === "number" && Number.isInteger(raw.low_stock) && raw.low_stock >= 0 ? raw.low_stock : null;
      const nutrition = Array.isArray(raw.nutrition) ? raw.nutrition.flatMap((row): ProductInput["nutrition"] => isObject(row) && str(row, "label") && str(row, "value") ? [{ label: str(row, "label")!, value: str(row, "value")!, unit: null }] : []) : [];
      const attributes = Array.isArray(raw.attributes) ? raw.attributes.flatMap((attribute) => isObject(attribute) ? [`${str(attribute, "name") ?? ""} ${Array.isArray(attribute.terms) ? attribute.terms.join(" ") : ""}`] : []) : [];
      return {
        product_id: id, name: decodeHtml(name), brand: brands[0] ? decodeHtml(brands[0]) : null, price, unit_price: null,
        availability: raw.in_stock && raw.purchasable !== false ? "available" : "out_of_stock", available_quantity: low,
        organic: isOrganic(`${name} ${attributes.join(" ")}`), product_url: requestedUrl,
        ean: str(raw, "gtin"), ingredients: str(raw, "ingredients"), vegan_claim: hasVeganClaim(`${name} ${description}`), nutrition,
      };
    },
    cartExpression: () => cartExpression(),
    normalizeCart(raw): CartInput {
      if (!isObject(raw) || !Array.isArray(raw.items)) throw new ContractChangedError("Le panier n’a plus la forme observée.");
      const minor = raw.currency_minor_unit;
      const items = raw.items.map((entry) => {
        if (!isObject(entry)) throw new ContractChangedError("Une ligne de panier n’est plus exploitable.");
        const id = str(entry, "id");
        const quantity = Number(entry.quantity);
        if (!id || !Number.isInteger(quantity) || quantity < 0) throw new ContractChangedError("Une ligne de panier ne contient plus son identifiant ou sa quantité.");
        const maximum = typeof entry.maximum === "number" && Number.isInteger(entry.maximum) && entry.maximum >= 0 ? entry.maximum : null;
        return { product_id: id, name: str(entry, "name"), quantity, available_quantity: maximum, unit_price: minorToNumber(entry.price, minor), line_total: minorToNumber(entry.line_total, minor) };
      });
      const total = minorToNumber(raw.total_price, minor);
      const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
      return { empty: totalQuantity === 0, total_quantity: totalQuantity, total_price: total === null ? "0,00 €" : new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(total), items };
    },
    mutationExpression: (_config, input) => mutationExpression(input),
  };
}
