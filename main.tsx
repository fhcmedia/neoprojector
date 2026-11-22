import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { shareBindings } from "@/lib/plain-bindings";
import { AnimationsProvider } from "@/hooks/use-animations";
import { ServiceNameFormatProvider } from "@/hooks/use-service-name-format";
import { BibleTranslationsProvider } from "@/hooks/use-bible-translations";
import { VimModeProvider } from "@/hooks/use-vim-mode";
import { LibraryAutoCollapseProvider } from "@/hooks/use-library-auto-collapse";
import { IS_OPERATOR_WINDOW, LiveProvider } from "@/features/live/live-context";
import { restoreFromHandoff } from "@/features/live/handoff";
import { routeTree } from "./routeTree.gen";
import "./app.css";
import "@/features/templates/fonts-bundle";

// No refetch-on-focus: every byte of data comes from this app's own
// database, and each save refreshes what it changed. Refetching on
// focus only made alt-tabbing back redraw everything (bindings return
// class instances, so even unchanged data arrives as new objects and
// every preview re-measured its text: a visible flicker).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, structuralSharing: shareBindings },
  },
});

function makeRouter() {
  return createRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
    context: { queryClient },
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof makeRouter>;
  }
}

// After an instant update, restore the operator window's session and
// URL first: the router reads the URL when it's created.
if (IS_OPERATOR_WINDOW) await restoreFromHandoff();
const router = makeRouter();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AnimationsProvider>
      <ServiceNameFormatProvider>
        <BibleTranslationsProvider>
          <VimModeProvider>
            <LibraryAutoCollapseProvider>
              <QueryClientProvider client={queryClient}>
                <LiveProvider>
                  <RouterProvider router={router} />
                </LiveProvider>
              </QueryClientProvider>
            </LibraryAutoCollapseProvider>
          </VimModeProvider>
        </BibleTranslationsProvider>
      </ServiceNameFormatProvider>
    </AnimationsProvider>
  </React.StrictMode>,
);
