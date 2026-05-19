import { createRootRoute, Outlet } from "@tanstack/react-router"
import { AuthProvider } from "@/hooks/use-auth"
import { KickModal } from "@/components/kick-modal"

export const Route = createRootRoute({
  component: () => (
    <AuthProvider>
      <Outlet />
      <KickModal />
    </AuthProvider>
  ),
})
