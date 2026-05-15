import type { Metadata } from "next"
import Link from "next/link"
import { LoginForm } from "@/components/auth/login-form"

export const metadata: Metadata = {
  title: "Connexion — Glan",
  description: "Connectez-vous à votre espace pour accéder à vos prospects bilan carbone qualifiés.",
}

// La page de connexion ne doit pas être prérendue : le client Supabase a
// besoin des variables d'env runtime (NEXT_PUBLIC_SUPABASE_*) qui ne sont
// pas garanties au moment du build (cas dev local sans .env.local).
export const dynamic = 'force-dynamic'

export default function LoginPage() {
  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="space-y-1.5">
        <h1 className="bg-gradient-to-br from-white to-green-200 bg-clip-text text-2xl font-extrabold tracking-tight text-transparent">
          Bon retour
        </h1>
        <p className="text-sm text-gray-400">
          Connectez-vous pour accéder à vos prospects qualifiés.
        </p>
      </div>

      {/* Carte formulaire — glass tech */}
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] shadow-[0_8px_32px_-12px_rgba(0,0,0,0.5)] backdrop-blur-xl p-7">
        <LoginForm />
      </div>

      {/* Pied : lien inscription */}
      <p className="text-center text-sm text-gray-500">
        Pas encore de compte ?{" "}
        <Link
          href="/signup"
          className="font-medium text-cyan-400 transition-colors hover:text-cyan-300"
        >
          Commencer gratuitement
        </Link>
      </p>
    </div>
  )
}
