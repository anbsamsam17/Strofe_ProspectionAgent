import Link from 'next/link'

// Landing page minimaliste — redirige vers login ou dashboard
export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-green-50 to-white dark:from-gray-900 dark:to-gray-950 px-4">
      <div className="max-w-2xl text-center space-y-8">

        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-3 py-1 rounded-full text-sm font-medium">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            Agent IA actif
          </div>

          <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-white">
            15 appels qualifiés.
            <br />
            <span className="text-green-600 dark:text-green-400">Chaque matin.</span>
          </h1>

          <p className="text-lg text-gray-600 dark:text-gray-400 max-w-xl mx-auto">
            L'agent sourcé, scoré et préparé vos pitchs pendant la nuit.
            Vous n'avez plus qu'à décrocher le téléphone.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/signup"
            className="inline-flex items-center justify-center px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-colors"
          >
            Commencer gratuitement
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center px-6 py-3 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-semibold rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Se connecter
          </Link>
        </div>

        <div className="grid grid-cols-3 gap-6 pt-8 border-t border-gray-200 dark:border-gray-700">
          {[
            { label: 'Prospects sourcés', value: 'Sirene + ADEME' },
            { label: 'Pitchs générés par', value: 'Claude Sonnet' },
            { label: 'Déployé sur', value: 'Vercel + Supabase' },
          ].map((item) => (
            <div key={item.label} className="text-center">
              <div className="font-semibold text-gray-900 dark:text-white text-sm">{item.value}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{item.label}</div>
            </div>
          ))}
        </div>

      </div>
    </main>
  )
}
