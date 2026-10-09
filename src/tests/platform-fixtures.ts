import type { ShopConfig } from "../client/config.js";
import { RETAILER } from "../client/retailer.js";
import { FakeBrowser } from "./fake-browser.js";

import type { Captured } from "./fake-browser.js";
export type { Captured };

type RawCart = { currency_minor_unit: number; total_price: string; items: Array<Record<string, unknown>> };

export function buildWooCommerceShop(data: Captured, scope: Record<string, string> = {}) {
  const config: ShopConfig = {
    scope,
    camoufoxUrl: "http://127.0.0.1:9377",
    camoufoxUserId: "test-profile-user",
    camoufoxApiKey: "0123456789abcdefghijklmnopqrstuvwxyzAB",
  };
  let quantity = 0;
  const filled = data.cartFilled.raw as RawCart;
  const line = filled.items[0];
  const unit = Number(line.price);
  const cartRaw = (count: number): RawCart => {
    if (count === 0) return data.cartEmpty as RawCart;
    return { ...filled, total_price: String(unit * count), items: [{ ...line, quantity: count, line_total: String(unit * count) }] };
  };
  const snapshot = `navigation "Menu"\nlink "Mon compte"\nlink "Panier"\ntext "${RETAILER.label}"`;
  const browser = new FakeBrowser(RETAILER.entryUrl, snapshot, {
    search: () => data.searchRaw,
    product: () => data.productRaw,
    cart: () => cartRaw(quantity),
    mutate: (_productId, target) => { const before = cartRaw(quantity); quantity = target; return { before, after: cartRaw(quantity), applied: true }; },
  });
  return { config, browser, cartQuantity: () => quantity, setCartQuantity: (value: number) => { quantity = value; } };
}
