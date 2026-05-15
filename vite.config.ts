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
})
