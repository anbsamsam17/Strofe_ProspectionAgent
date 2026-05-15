import Link from 'next/link'

export default function ProspectNotFound() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 py-16 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-gray-400 dark:text-gray-600"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </div>
      <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
        Prospect introuvable
      </h1>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Ce prospect n&apos;existe pas, ou il ne fait pas partie de votre
        portefeuille.
      </p>
      <Link
        href="/prospects"
        className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-green-700"
      >
        Retour aux prospects
      </Link>
    </div>
  )
}
