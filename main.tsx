import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { AnimationsProvider } from "@/hooks/use-animations";
import { routeTree } from "./routeTree.gen";
import "./app.css";

const queryClient = new QueryClient();

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  scrollRestoration: true,
  context: { queryClient },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <AnimationsProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </AnimationsProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
