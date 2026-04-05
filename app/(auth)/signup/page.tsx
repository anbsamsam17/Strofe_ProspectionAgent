import type { Metadata } from 'next'
import { SignupForm } from '@/components/auth/signup-form'

export const metadata: Metadata = {
  title: 'Créer un compte — DecarbonLeads',
  description: 'Inscrivez-vous à DecarbonLeads et recevez 15 prospects qualifiés bilan carbone chaque matin.',
}

export default function SignupPage() {
  return (
    <div className="rounded-2xl bg-white shadow-sm border border-gray-200 p-8 space-y-6">
      {/* En-tête de page */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
          Créer un compte
        </h1>
        <p className="text-sm text-gray-500">
          Commencez à prospecter avec l&apos;IA dès aujourd&apos;hui.
        </p>
      </div>

      {/* Proposition de valeur */}
      <div className="rounded-lg bg-green-50 border border-green-100 px-4 py-3">
        <ul className="space-y-1.5 text-sm text-green-800">
          <li className="flex items-center gap-2">
            <svg className="h-4 w-4 text-green-600 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            15 appels qualifiés générés chaque nuit
          </li>
          <li className="flex items-center gap-2">
            <svg className="h-4 w-4 text-green-600 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            Pitchs sur-mesure et objections préparées
          </li>
          <li className="flex items-center gap-2">
            <svg className="h-4 w-4 text-green-600 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            Données BEGES et signaux d&apos;intention inclus
          </li>
        </ul>
      </div>

      {/* Séparateur */}
      <div className="h-px bg-gray-100" />

      {/* Formulaire */}
      <SignupForm />
    </div>
  )
}
