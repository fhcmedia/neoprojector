import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AnimationsProvider } from "@/hooks/use-animations";
import { ServiceNameFormatProvider } from "@/hooks/use-service-name-format";
import { BibleTranslationsProvider } from "@/hooks/use-bible-translations";
import { VimModeProvider } from "@/hooks/use-vim-mode";
import { LiveProvider } from "@/features/live/live-context";
import { routeTree } from "./routeTree.gen";
import "./app.css";
import "@/features/templates/fonts-bundle";

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
    <AnimationsProvider>
      <ServiceNameFormatProvider>
        <BibleTranslationsProvider>
          <VimModeProvider>
            <QueryClientProvider client={queryClient}>
              <LiveProvider>
                <RouterProvider router={router} />
              </LiveProvider>
            </QueryClientProvider>
          </VimModeProvider>
        </BibleTranslationsProvider>
      </ServiceNameFormatProvider>
    </AnimationsProvider>
  </React.StrictMode>,
);
