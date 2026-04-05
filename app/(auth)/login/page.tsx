import type { Metadata } from 'next'
import { LoginForm } from '@/components/auth/login-form'

export const metadata: Metadata = {
  title: 'Connexion — DecarbonLeads',
  description: 'Connectez-vous à votre espace DecarbonLeads pour accéder à vos prospects bilan carbone.',
}

export default function LoginPage() {
  return (
    <div className="rounded-2xl bg-white shadow-sm border border-gray-200 p-8 space-y-6">
      {/* En-tête de page */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
          Bon retour 👋
        </h1>
        <p className="text-sm text-gray-500">
          Connectez-vous pour accéder à vos prospects du jour.
        </p>
      </div>

      {/* Séparateur */}
      <div className="h-px bg-gray-100" />

      {/* Formulaire de connexion */}
      <LoginForm />
    </div>
  )
}
