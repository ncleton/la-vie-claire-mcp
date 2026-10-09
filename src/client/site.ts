import { createWooCommerceAdapter } from "./platform.js";

export const adapter = createWooCommerceAdapter({
  origin: "https://www.lavieclaire.com",
  hosts: ["www.lavieclaire.com", "lavieclaire.com"],
  productPathPrefix: "/produit/",
});
