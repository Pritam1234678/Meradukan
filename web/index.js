// index.js (backend entrypoint)

import express from "express";
import { join } from "path";
import { readFileSync } from "fs";
import serveStatic from "serve-static";

import shopify from "./shopify.js"; // your Shopify setup helper
import productCreator from "./product-creator.js"; // your product logic
import PrivacyWebhookHandlers from "./privacy.js"; // webhook handlers

// Use environment variable PORT or default to 3000
const PORT = parseInt(process.env.BACKEND_PORT || process.env.PORT || "3000", 10);

// Path to frontend static files
const STATIC_PATH =
  process.env.NODE_ENV === "production"
    ? join(process.cwd(), "frontend", "dist")
    : join(process.cwd(), "frontend");

// Create Express app
const app = express();

// Shopify auth routes
app.get(shopify.config.auth.path, shopify.auth.begin());
app.get(
  shopify.config.auth.callbackPath,
  shopify.auth.callback(),
  shopify.redirectToShopifyOrAppRoot()
);

// Shopify webhook endpoint
app.post(
  shopify.config.webhooks.path,
  shopify.processWebhooks({ webhookHandlers: PrivacyWebhookHandlers })
);

// Middleware to protect API routes, require Shopify session
app.use("/api/*", shopify.validateAuthenticatedSession());

// Enable JSON body parsing for POST requests
app.use(express.json());

// Sample API route: get product count in store
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

// Sample API route: create products
app.post("/api/products", async (_req, res) => {
  try {
    await productCreator(res.locals.shopify.session);
    res.status(200).send({ success: true });
  } catch (error) {
    console.error("Failed to create products:", error);
    res.status(500).send({ success: false, error: error.message });
  }
});

// Set Shopify recommended Content Security Policy headers
app.use(shopify.cspHeaders());

// Serve frontend static files (from dist in production)
app.use(serveStatic(STATIC_PATH, { index: false }));

// For any other route, serve the index.html frontend, injecting the Shopify API key
app.use("/*", shopify.ensureInstalledOnShop(), async (_req, res) => {
  try {
    const indexFile = readFileSync(join(STATIC_PATH, "index.html")).toString();

    // Replace placeholder with actual Shopify API key from env
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

// Start server
app.listen(PORT, () => {
  console.log(`> Shopify app backend listening on port ${PORT}`);
});
