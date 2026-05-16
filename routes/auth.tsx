import { useState, useEffect } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { GradFlow } from "gradflow"
import { motion, AnimatePresence } from "motion/react"
import { useAuth } from "@/hooks/use-auth"
import { Input } from "@/components/input"
import { Label } from "@/components/label"

export const Route = createFileRoute("/auth")({
  component: AuthPage,
})

function AnimatedInput({
  id,
  type = "text",
  value,
  onChange,
  className,
  placeholder,
}: {
  id: string
  type?: string
  value: string
  onChange: (e: any) => void
  className?: string
  placeholder?: string
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={`${className} text-transparent caret-white`}
      />
      <div className="pointer-events-none absolute inset-0 flex items-center px-4 overflow-hidden whitespace-pre md:text-sm text-base text-white">
        {!value && placeholder && <span className="opacity-0">{placeholder}</span>}
        {value.split("").map((char, i) => (
          <motion.span
            key={i}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
          >
            {type === "password" ? "•" : char}
          </motion.span>
        ))}
      </div>
    </div>
  )
}

function AuthPage() {
  const [tab, setTab] = useState<"login" | "signup">("login")

  const staggerContainer = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.1, delayChildren: 0.3 }
    },
    exit: { opacity: 0, transition: { duration: 0.3 } }
  }

  const staggerItem = {
    hidden: { opacity: 0, y: 15 },
    show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } }
  }
  const { login, signup, isAuthenticated } = useAuth()
  const navigate = useNavigate()

  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [license, setLicense] = useState("")
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    // Only navigate immediately if we are authenticated AND not actively showing the loading animation
    if (isAuthenticated && !isLoading) {
      navigate({ to: "/", replace: true })
    }
  }, [isAuthenticated, isLoading, navigate])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    let success = false
    if (tab === "login") {
      success = login(username, password)
      if (!success) setError("Invalid credentials. Try test/test")
    } else {
      success = signup(username, password, license)
      if (!success) setError("Please fill all fields")
    }

    if (success) {
      setIsLoading(true)
      setTimeout(() => {
        setIsLoading(false) // This will trigger the useEffect to navigate
      }, 1500)
    }
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black text-white">
      <div className="absolute inset-0 z-0">
        <GradFlow
          config={{
            color1: { r: 163, g: 106, b: 242 },
            color2: { r: 0, g: 0, b: 0 },
            color3: { r: 234, g: 130, b: 106 },
            speed: 0.6,
            scale: 1.2,
            type: "silk",
            noise: 0.18,
          }}
        />
      </div>

      <div className="relative z-10 flex h-full items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut", delay: 0.2 }}
          className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-black/40 p-8 shadow-2xl backdrop-blur-xl"
        >
          <AnimatePresence mode="wait">
            {isLoading ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.05 }}
                transition={{ duration: 0.4 }}
                className="flex flex-col items-center justify-center py-12"
              >
                <div className="relative mb-6 h-16 w-16">
                  <motion.div
                    className="absolute inset-0 rounded-full border-4 border-white/10"
                  />
                  <motion.div
                    className="absolute inset-0 rounded-full border-4 border-white border-t-transparent"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  />
                </div>
                <h2 className="text-xl font-medium tracking-tight text-white">
                  Authenticating...
                </h2>
                <p className="mt-2 text-sm text-white/50">Preparing your workspace</p>
              </motion.div>
            ) : (
              <motion.div
                key="form"
                variants={staggerContainer}
                initial="hidden"
                animate="show"
                exit="exit"
              >
                <motion.div variants={staggerItem} className="mb-8 text-center">
                  <h1 className="text-3xl font-bold tracking-tight">
                    Welcome to NeoProjector
                  </h1>
                  <p className="mt-2 text-sm text-white/60">
                    Please {tab === "login" ? "log in" : "sign up"} to continue
                  </p>
                </motion.div>

                <motion.div variants={staggerItem} className="mb-8 flex relative rounded-xl bg-white/5 p-1 backdrop-blur-sm">
                  {["login", "signup"].map((t) => (
                    <button
                      key={t}
                      onClick={() => setTab(t as "login" | "signup")}
                      className={`relative z-10 flex-1 rounded-lg py-2.5 text-sm font-medium transition-colors duration-300 ${
                        tab === t ? "text-black" : "text-white/60 hover:text-white"
                      }`}
                    >
                      {t === "login" ? "Login" : "Sign Up"}
                      {tab === t && (
                        <motion.div
                          layoutId="activeTab"
                          className="absolute inset-0 -z-10 rounded-lg bg-white"
                          transition={{ type: "spring", stiffness: 400, damping: 30 }}
                        />
                      )}
                    </button>
                  ))}
                </motion.div>

                <form onSubmit={handleSubmit} className="space-y-5">
                  <motion.div variants={staggerItem} className="space-y-1.5">
                    <Label htmlFor="username" className="text-white/70 ml-1">Username</Label>
                    <AnimatedInput
                      id="username"
                      value={username}
                      onChange={(e: any) => setUsername(e.target.value)}
                      className="rounded-xl border-white/10 bg-white/10 px-4 py-6 placeholder:text-white/30 transition-all focus-visible:ring-2 focus-visible:ring-white/20 focus-visible:bg-white/15"
                      placeholder="Enter your username"
                    />
                  </motion.div>
                  <motion.div variants={staggerItem} className="space-y-1.5">
                    <Label htmlFor="password" className="text-white/70 ml-1">Password</Label>
                    <AnimatedInput
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e: any) => setPassword(e.target.value)}
                      className="rounded-xl border-white/10 bg-white/10 px-4 py-6 placeholder:text-white/30 transition-all focus-visible:ring-2 focus-visible:ring-white/20 focus-visible:bg-white/15"
                      placeholder="Enter your password"
                    />
                  </motion.div>

                  <AnimatePresence>
                    {tab === "signup" && (
                      <motion.div
                        variants={staggerItem}
                        initial="hidden"
                        animate="show"
                        exit={{ opacity: 0, height: 0, marginTop: 0 }}
                        className="space-y-1.5"
                      >
                      <Label htmlFor="license" className="text-white/70 ml-1">License Key</Label>
                      <AnimatedInput
                        id="license"
                        value={license}
                        onChange={(e: any) => setLicense(e.target.value)}
                        className="rounded-xl border-white/10 bg-white/10 px-4 py-6 placeholder:text-white/30 transition-all focus-visible:ring-2 focus-visible:ring-white/20 focus-visible:bg-white/15"
                        placeholder="XXXX-XXXX-XXXX-XXXX"
                      />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {error && (
                    <motion.p variants={staggerItem} className="text-sm text-red-400">{error}</motion.p>
                  )}

                  <motion.div 
                    variants={staggerItem}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className="pt-2"
                  >
                    <button
                      type="submit"
                      className="w-full rounded-xl bg-white px-4 py-3.5 text-sm font-medium text-black shadow-[0_0_20px_rgba(255,255,255,0.1),0_0_10px_rgba(255,255,255,0.05)] transition-all hover:bg-white/90 hover:shadow-[0_0_30px_rgba(255,255,255,0.3),0_0_60px_rgba(255,255,255,0.15)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                    >
                      {tab === "login" ? "Sign In" : "Activate License"}
                    </button>
                  </motion.div>
                </form>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  )
}
