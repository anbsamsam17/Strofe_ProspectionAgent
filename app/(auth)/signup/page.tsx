import type { Metadata } from "next"
import Link from "next/link"
import { SignupForm } from "@/components/auth/signup-form"

export const metadata: Metadata = {
  title: "Créer un compte — Glan",
  description: "Inscrivez-vous et recevez des prospects bilan carbone qualifiés chaque nuit par Glan.",
}

// Cf. login/page.tsx — la page ne doit pas être prérendue.
export const dynamic = 'force-dynamic'

export default function SignupPage() {
  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="space-y-1.5">
        <h1 className="bg-gradient-to-br from-white to-green-200 bg-clip-text text-2xl font-extrabold tracking-tight text-transparent">
          Créer un compte
        </h1>
        <p className="text-sm text-gray-400">
          Glan commence à sourcer vos prospects dès cette nuit.
        </p>
      </div>

      {/* Carte formulaire — glass tech */}
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] shadow-[0_8px_32px_-12px_rgba(0,0,0,0.5)] backdrop-blur-xl p-7">
        <SignupForm />
      </div>

      {/* Pied : lien connexion */}
      <p className="text-center text-sm text-gray-500">
        Déjà inscrit ?{" "}
        <Link
          href="/login"
          className="font-medium text-cyan-400 transition-colors hover:text-cyan-300"
        >
          Se connecter
        </Link>
      </p>
    </div>
  )
}
