import type { Metadata } from "next"
import Link from "next/link"
import { SignupForm } from "@/components/auth/signup-form"

export const metadata: Metadata = {
  title: "Creer un compte — DecarbonLeads",
  description: "Inscrivez-vous a DecarbonLeads et recevez 15 prospects qualifies bilan carbone chaque matin.",
}

export default function SignupPage() {
  return (
    <div className="space-y-6">
      {/* En-tete */}
      <div className="space-y-1.5">
        <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white tracking-tight">
          Creer un compte
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Votre premier rapport de prospects arrive cette nuit.
        </p>
      </div>

      {/* Carte formulaire */}
      <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xl shadow-gray-900/5 dark:shadow-gray-900/50 p-7">
        <SignupForm />
      </div>

      {/* Pied : lien connexion */}
      <p className="text-center text-sm text-gray-500 dark:text-gray-400">
        Deja inscrit ?{" "}
        <Link
          href="/login"
          className="font-semibold text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 transition-colors"
        >
          Se connecter
        </Link>
      </p>
    </div>
  )
}
