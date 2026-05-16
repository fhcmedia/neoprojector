import { createRootRoute, Outlet } from "@tanstack/react-router"
import { AuthProvider } from "@/hooks/use-auth"

export const Route = createRootRoute({
  component: () => (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  ),
})
