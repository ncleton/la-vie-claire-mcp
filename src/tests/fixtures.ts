import { buildWooCommerceShop } from "./platform-fixtures.js";
import { captured } from "./data.js";

export const productUrl = captured.productUrl;
export const expected = { query: captured.query, ...captured.expected };
export const robotSnapshot = 'heading "Vérification de sécurité"\nlink "Mon compte"';
export function createShop() { return buildWooCommerceShop(captured); }
