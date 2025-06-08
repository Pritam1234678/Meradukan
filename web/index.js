
import express from "express";
import { join } from "path";
import { readFileSync } from "fs";
import serveStatic from "serve-static";

import shopify from "./shopify.js";
import productCreator from "./product-creator.js";
import PrivacyWebhookHandlers from "./privacy.js";
console.log("HOST_NAME from env:", process.env.HOST_NAME);

// Use PORT from env or fallback to 3000
const PORT = parseInt(process.env.BACKEND_PORT || process.env.PORT || "3000", 10);

// Path to frontend build directory (dist in production)
const STATIC_PATH =
  process.env.NODE_ENV === "production"
    ? join(process.cwd(), "frontend", "dist")
    : join(process.cwd(), "frontend");

const app = express();

// Shopify OAuth routes
app.get(shopify.config.auth.path, shopify.auth.begin());
app.get(
  shopify.config.auth.callbackPath,
  shopify.auth.callback(),
  shopify.redirectToShopifyOrAppRoot()
);

// Shopify webhook handler endpoint
app.post(
  shopify.config.webhooks.path,
  shopify.processWebhooks({ webhookHandlers: PrivacyWebhookHandlers })
);

// Middleware to validate Shopify session for API routes
app.use("/api/*", shopify.validateAuthenticatedSession());

// Enable JSON parsing middleware
app.use(express.json());

// API: Get product count from Shopify store
app.get("/api/products/count", async (_req, res) => {
  try {
    const client = new shopify.api.clients.Graphql({
      session: res.locals.shopify.session,
    });

    const countData = await client.request(`
      query {
        productsCount {
          count
        }
      }
    `);

    res.status(200).send({ count: countData.data.productsCount.count });
  } catch (error) {
    console.error("Failed to fetch product count:", error);
    res.status(500).send({ error: "Failed to fetch product count" });
  }
});

// API: Create products (calls your product-creator logic)
app.post("/api/products", async (_req, res) => {
  try {
    await productCreator(res.locals.shopify.session);
    res.status(200).send({ success: true });
  } catch (error) {
    console.error("Failed to create products:", error);
    res.status(500).send({ success: false, error: error.message });
  }
});

// Set Shopify-recommended Content Security Policy headers
app.use(shopify.cspHeaders());

// Serve frontend static assets
app.use(serveStatic(STATIC_PATH, { index: false }));

// For all other routes, serve index.html with injected Shopify API key
app.use("/*", shopify.ensureInstalledOnShop(), async (_req, res) => {
  try {
    const indexFile = readFileSync(join(STATIC_PATH, "index.html")).toString();

    // Inject the Shopify API key into the frontend
    const replaced = indexFile.replace(
      "%VITE_SHOPIFY_API_KEY%",
      process.env.SHOPIFY_API_KEY || ""
    );

    res.status(200).set("Content-Type", "text/html").send(replaced);
  } catch (error) {
    console.error("Failed to serve index.html:", error);
    res.status(500).send("Internal Server Error");
  }
});

// Start Express server
app.listen(PORT, () => {
  console.log(`> Shopify app backend listening on port ${PORT}`);
});
