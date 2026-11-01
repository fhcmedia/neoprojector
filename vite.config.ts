import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import { resolve } from "node:path"

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: "./routes",
      generatedRouteTree: "./routeTree.gen.ts",
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "."),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 9245,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      output: {
        // pdf.js ships its worker as .mjs. Go's file server types files
        // by extension, and on Windows that lookup can come from the
        // registry, where .mjs is often text/plain — a module worker
        // served as text/plain is refused, and deck import breaks.
        // Emit it as .js, which is JavaScript everywhere.
        assetFileNames: (asset) =>
          (asset.names?.[0] ?? asset.name ?? "").endsWith(".mjs")
            ? "assets/[name]-[hash].js"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
})
