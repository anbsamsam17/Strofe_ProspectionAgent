import type { Metadata } from "next"
import Link from "next/link"
import { LoginForm } from "@/components/auth/login-form"

export const metadata: Metadata = {
  title: "Connexion — DecarbonLeads",
  description: "Connectez-vous a votre espace DecarbonLeads pour acceder a vos prospects bilan carbone.",
}

export default function LoginPage() {
  return (
    <div className="space-y-6">
      {/* En-tete */}
      <div className="space-y-1.5">
        <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white tracking-tight">
          Bon retour
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Connectez-vous pour acceder a vos prospects du jour.
        </p>
      </div>

      {/* Carte formulaire */}
      <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xl shadow-gray-900/5 dark:shadow-gray-900/50 p-7">
        <LoginForm />
      </div>

      {/* Pied : lien inscription */}
      <p className="text-center text-sm text-gray-500 dark:text-gray-400">
        Pas encore de compte ?{" "}
        <Link
          href="/signup"
          className="font-semibold text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 transition-colors"
        >
          Commencer gratuitement
        </Link>
      </p>
    </div>
  )
}
