import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Mentions RGPD — Prospection BEGES | Glan',
  description:
    "Information CNIL sur le traitement des données de prospection commerciale B2B pour les services bilan carbone (Article L. 229-25).",
}

export default function ProspectionLegalPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 sm:px-8 sm:py-16">
      <article className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-8 backdrop-blur-md sm:p-10">
        <header className="mb-8 border-b border-white/[0.06] pb-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-400/80">
            {'// Mentions légales · Prospection commerciale'}
          </p>
          <h1 className="mt-3 bg-gradient-to-br from-white to-green-200 bg-clip-text text-3xl font-bold tracking-tight text-transparent sm:text-4xl">
            Information RGPD &mdash; Prospection BEGES
          </h1>
          <p className="mt-3 text-sm text-gray-400">
            Dernière mise à jour : 15 mai 2026
          </p>
        </header>

        <section className="space-y-8 text-gray-200 leading-relaxed">
          {/* TODO(GLN-001): infos juridiques à valider par juriste avant déploiement prod */}
          <div>
            <h2 className="mb-3 text-xl font-semibold text-white">
              1. Responsable du traitement
            </h2>
            <p>
              Le présent service de prospection commerciale est édité par{' '}
              <strong className="text-white">STROFE</strong>.
            </p>
            <ul className="mt-3 list-inside list-disc space-y-1.5 text-gray-300">
              <li>
                Forme juridique :{' '}
                <span className="text-gray-400">[à valider juriste]</span>
              </li>
              <li>
                SIREN : <span className="text-gray-400">[à finaliser]</span>
              </li>
              <li>
                Siège social :{' '}
                <span className="text-gray-400">[à finaliser]</span>
              </li>
              <li>
                Contact référent données personnelles :{' '}
                <a
                  href="mailto:samir.anbri@strofe.fr"
                  className="text-cyan-400 underline hover:text-cyan-300"
                >
                  samir.anbri@strofe.fr
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h2 className="mb-3 text-xl font-semibold text-white">
              2. Finalité du traitement
            </h2>
            <p>
              Prospection commerciale B2B pour des services de conseil en bilan
              carbone (BEGES) à destination des dirigeants d&apos;entreprises
              soumises à l&apos;obligation légale prévue par l&apos;
              <strong className="text-white">
                Article L. 229-25 du Code de l&apos;environnement
              </strong>
              .
            </p>
          </div>

          <div>
            <h2 className="mb-3 text-xl font-semibold text-white">
              3. Base légale
            </h2>
            <p>
              <strong className="text-white">
                Article 6.1.f du RGPD &mdash; intérêt légitime.
              </strong>{' '}
              Justification : démarchage d&apos;entreprises identifiées comme
              assujetties à une obligation légale BEGES, services pertinents
              pour leur fonction professionnelle (DAF, RSE, DG, DRH), avec un
              mécanisme d&apos;opposition (opt-out) accessible en un clic.
            </p>
          </div>

          <div>
            <h2 className="mb-3 text-xl font-semibold text-white">
              4. Sources des données
            </h2>
            <ul className="list-inside list-disc space-y-1.5 text-gray-300">
              <li>
                INSEE Sirene &mdash;{' '}
                <a
                  href="https://www.sirene.fr"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 underline hover:text-cyan-300"
                >
                  www.sirene.fr
                </a>
              </li>
              <li>
                ADEME (publications BEGES) &mdash;{' '}
                <a
                  href="https://data.ademe.fr"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 underline hover:text-cyan-300"
                >
                  data.ademe.fr
                </a>
              </li>
              <li>
                Recherche Entreprises (annuaire-entreprises.data.gouv.fr) &mdash;{' '}
                <a
                  href="https://annuaire-entreprises.data.gouv.fr"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 underline hover:text-cyan-300"
                >
                  annuaire-entreprises.data.gouv.fr
                </a>
              </li>
              <li>
                INPI &mdash; Registre National des Entreprises (RNE) &mdash;{' '}
                <a
                  href="https://www.inpi.fr"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 underline hover:text-cyan-300"
                >
                  www.inpi.fr
                </a>
              </li>
              <li>
                BODACC (Bulletin Officiel des Annonces Civiles et
                Commerciales) &mdash;{' '}
                <a
                  href="https://www.bodacc.fr"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 underline hover:text-cyan-300"
                >
                  www.bodacc.fr
                </a>
              </li>
              <li>
                Pappers &mdash;{' '}
                <a
                  href="https://www.pappers.fr"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 underline hover:text-cyan-300"
                >
                  www.pappers.fr
                </a>
              </li>
              <li>
                Hunter (recherche pattern email organisationnel) &mdash;{' '}
                <a
                  href="https://hunter.io"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 underline hover:text-cyan-300"
                >
                  hunter.io
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h2 className="mb-3 text-xl font-semibold text-white">
              5. Catégories de données traitées
            </h2>
            <ul className="list-inside list-disc space-y-1.5 text-gray-300">
              <li>
                Identité légale de l&apos;entreprise (SIREN, raison sociale,
                code NAF, effectif, adresse siège)
              </li>
              <li>
                Identité du dirigeant (nom, prénom, fonction &mdash; données
                publiques RCS/RNE)
              </li>
              <li>Email professionnel</li>
              <li>Téléphone professionnel (standard / fixe)</li>
              <li>URL de profil LinkedIn professionnel</li>
            </ul>
            <p className="mt-3 text-sm text-gray-400">
              Aucune donnée sensible (santé, opinions, etc.) n&apos;est traitée.
            </p>
          </div>

          <div>
            <h2 className="mb-3 text-xl font-semibold text-white">
              6. Durée de conservation
            </h2>
            <p>
              <strong className="text-white">3 ans</strong> à compter du dernier
              contact effectif. Une purge automatique quotidienne supprime les
              prospects au-delà de ce délai, sauf consentement explicite à
              prolonger.
            </p>
          </div>

          <div>
            <h2 className="mb-3 text-xl font-semibold text-white">7. Vos droits</h2>
            <p className="mb-3">
              Conformément aux articles 12 à 22 du RGPD, vous disposez des
              droits suivants sur vos données :
            </p>
            <ul className="list-inside list-disc space-y-1.5 text-gray-300">
              <li>Droit d&apos;accès</li>
              <li>Droit de rectification</li>
              <li>Droit à l&apos;effacement (« droit à l&apos;oubli »)</li>
              <li>Droit à la limitation du traitement</li>
              <li>
                Droit d&apos;opposition &mdash; un{' '}
                <strong className="text-white">lien de désinscription</strong>{' '}
                en un clic est inclus dans chaque email envoyé
              </li>
              <li>Droit à la portabilité</li>
            </ul>
            <p className="mt-4">
              Pour exercer ces droits, envoyez un email à{' '}
              <a
                href="mailto:samir.anbri@strofe.fr"
                className="text-cyan-400 underline hover:text-cyan-300"
              >
                samir.anbri@strofe.fr
              </a>{' '}
              en précisant votre demande. Nous répondrons dans un délai de 30
              jours maximum.
            </p>
          </div>

          <div>
            <h2 className="mb-3 text-xl font-semibold text-white">
              8. Cookies
            </h2>
            <p>
              Le service de prospection n&apos;utilise aucun cookie de
              tracking. Seuls des cookies techniques nécessaires au
              fonctionnement de l&apos;application authentifiée (session
              Supabase) sont déposés sur les utilisateurs connectés.
            </p>
          </div>

          <div>
            <h2 className="mb-3 text-xl font-semibold text-white">
              9. Réclamation CNIL
            </h2>
            <p>
              Si vous estimez que vos droits ne sont pas respectés, vous pouvez
              introduire une réclamation auprès de la Commission Nationale de
              l&apos;Informatique et des Libertés :{' '}
              <a
                href="https://www.cnil.fr/fr/plaintes"
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400 underline hover:text-cyan-300"
              >
                www.cnil.fr/fr/plaintes
              </a>
              .
            </p>
          </div>
        </section>

        <footer className="mt-10 border-t border-white/[0.06] pt-6">
          <Link
            href="/"
            className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-400/80 hover:text-cyan-300"
          >
            {'// Retour à l’accueil'}
          </Link>
        </footer>
      </article>
    </main>
  )
}
