// Fichier généré par generate.mjs à partir de retailers/la-vie-claire/spec.json. Ne pas modifier ici.
export interface ScopeField { key: string; env: string; description: string; example: string; pattern?: string }
export const RETAILER: {
  id: string; slug: string; version: string; label: string; origin: string; entryUrl: string; loginUrl: string; signupUrl: string;
  platform: string; fulfillment: ReadonlyArray<"delivery" | "click_and_collect">; accountRequired: boolean;
  scopeFields: ReadonlyArray<ScopeField>;
} = {
  "id": "la-vie-claire",
  "slug": "la_vie_claire",
  "version": "0.1.0",
  "label": "La Vie Claire",
  "origin": "https://www.lavieclaire.com",
  "entryUrl": "https://www.lavieclaire.com/",
  "loginUrl": "https://www.lavieclaire.com/mon-compte/",
  "signupUrl": "https://www.lavieclaire.com/mon-compte/",
  "platform": "woocommerce",
  "fulfillment": [
    "delivery",
    "click_and_collect"
  ],
  "accountRequired": false,
  "scopeFields": []
};
