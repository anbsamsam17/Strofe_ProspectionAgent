// ============================================================
// NAF CODES — Nomenclature d'activités française (révision 2)
// ------------------------------------------------------------
// Source : INSEE NAF rév.2 (publique)
// https://www.insee.fr/fr/information/2406147
//
// Liste des codes NAF utilisés pour le ciblage commercial de
// l'agent de prospection. Format des codes : `XX.XXX` (avec
// point décimal et sous-classe alphanumérique).
//
// Le sourcing Sirene normalise via `normalizeNafCodes()`
// (lib/agent/sourcing.ts) en supprimant le point — donc le
// format ici est cohérent avec ce qui est stocké côté UI.
//
// Couverture : 12 sections (A, B, C, D, E, F, G, H, I, J, K,
// L, M, N, P, Q, R, S) — soit l'essentiel des secteurs B2B
// pertinents pour la prospection BEGES. ~250+ codes.
// ============================================================

export interface NafCode {
  /** Code NAF au format `XX.XXX` (ex. `01.21Z`). */
  code: string
  /** Libellé officiel INSEE. */
  libelle: string
  /** Lettre de section (A = agriculture, C = industrie manufacturière, etc.). */
  section: string
  /** Libellé de la section. */
  section_libelle: string
}

/**
 * Suggestion de groupes pré-définis « prêts à l'emploi » pour la
 * prospection BEGES — utilisés dans le `SourcingModal` pour cocher
 * un secteur entier en un clic. Le détail individuel reste accessible
 * via le multi-select code par code.
 */
export interface NafGroup {
  label: string
  /** Codes NAF appartenant à ce groupe (format `XX.XXX`). */
  codes: string[]
}

// ── Suggérés prospection B2B BEGES ─────────────────────────────
//
// Les 9 secteurs prioritaires actuels (ex SECTOR_OPTIONS).
// Restent groupés pour cocher rapidement « tout l'agro » en un clic.
export const NAF_GROUPS_SUGGESTED: readonly NafGroup[] = [
  { label: 'Viticulture', codes: ['01.21Z', '01.22Z'] },
  { label: 'Aéronautique', codes: ['30.30Z'] },
  {
    label: 'Logistique / Transport',
    codes: ['52.10B', '52.29A', '49.41A', '49.41B', '52.21Z'],
  },
  {
    label: 'Agro-alimentaire',
    codes: ['10.11Z', '10.13A', '10.32Z', '10.51A', '10.71A', '46.17B'],
  },
  { label: 'Chimie', codes: ['20.11Z', '20.14Z', '20.15Z'] },
  { label: 'Sidérurgie / Métaux', codes: ['24.10Z', '24.20Z', '25.11Z', '25.29Z'] },
  { label: 'Énergie', codes: ['35.11Z', '35.14Z'] },
  {
    label: 'BTP',
    codes: ['41.20A', '41.20B', '42.11Z', '42.13A', '43.21A', '43.22A'],
  },
  { label: 'Hôtellerie / Restauration', codes: ['55.10Z', '56.10A'] },
] as const

// ── Sections ───────────────────────────────────────────────────

const SECTION_LIBELLE: Record<string, string> = {
  A: 'Agriculture, sylviculture et pêche',
  B: 'Industries extractives',
  C: 'Industrie manufacturière',
  D: "Production et distribution d'électricité, de gaz",
  E: "Production et distribution d'eau, assainissement, déchets",
  F: 'Construction',
  G: 'Commerce, réparation automobile',
  H: 'Transports et entreposage',
  I: 'Hébergement et restauration',
  J: 'Information et communication',
  K: "Activités financières et d'assurance",
  L: 'Activités immobilières',
  M: 'Activités spécialisées, scientifiques et techniques',
  N: 'Activités de services administratifs et de soutien',
  P: 'Enseignement',
  Q: 'Santé humaine et action sociale',
  R: 'Arts, spectacles et activités récréatives',
  S: 'Autres activités de services',
}

// Helper : construit une entrée { code, libelle, section, section_libelle }.
function n(code: string, libelle: string, section: string): NafCode {
  return {
    code,
    libelle,
    section,
    section_libelle: SECTION_LIBELLE[section] ?? section,
  }
}

// ── NAF_CODES : liste plate triée par code croissant ───────────
//
// Sélection des codes les plus représentés en France pour la
// prospection B2B BEGES. Tous les codes prioritaires (NAF_GROUPS_SUGGESTED)
// sont obligatoirement présents dans cette liste.
export const NAF_CODES: readonly NafCode[] = [
  // ── Section A — Agriculture, sylviculture et pêche ────────
  n('01.11Z', 'Culture de céréales (sauf riz), de légumineuses et de graines oléagineuses', 'A'),
  n('01.13Z', 'Culture de légumes, de melons, de racines et de tubercules', 'A'),
  n('01.21Z', 'Culture de la vigne', 'A'),
  n('01.22Z', 'Culture de fruits tropicaux et subtropicaux', 'A'),
  n('01.24Z', 'Culture de fruits à pépins et à noyau', 'A'),
  n('01.25Z', 'Culture d’autres fruits d’arbres ou d’arbustes et de fruits à coque', 'A'),
  n('01.41Z', 'Élevage de vaches laitières', 'A'),
  n('01.42Z', 'Élevage d’autres bovins et de buffles', 'A'),
  n('01.46Z', 'Élevage de porcins', 'A'),
  n('01.47Z', 'Élevage de volailles', 'A'),
  n('01.50Z', 'Culture et élevage associés', 'A'),
  n('01.61Z', 'Activités de soutien aux cultures', 'A'),
  n('02.10Z', 'Sylviculture et autres activités forestières', 'A'),
  n('02.20Z', 'Exploitation forestière', 'A'),
  n('03.11Z', 'Pêche en mer', 'A'),
  n('03.22Z', 'Aquaculture en eau douce', 'A'),

  // ── Section B — Industries extractives ────────────────────
  n('05.10Z', 'Extraction de houille', 'B'),
  n('06.10Z', 'Extraction de pétrole brut', 'B'),
  n('07.10Z', 'Extraction de minerais de fer', 'B'),
  n('08.11Z', 'Extraction de pierres ornementales et de construction, de calcaire industriel, de gypse, de craie et d’ardoise', 'B'),
  n('08.12Z', 'Exploitation de gravières et sablières, extraction d’argiles et de kaolin', 'B'),

  // ── Section C — Industrie manufacturière ──────────────────
  n('10.11Z', 'Transformation et conservation de la viande de boucherie', 'C'),
  n('10.12Z', 'Transformation et conservation de la viande de volaille', 'C'),
  n('10.13A', 'Préparation industrielle de produits à base de viande', 'C'),
  n('10.13B', 'Charcuterie', 'C'),
  n('10.20Z', 'Transformation et conservation de poisson, de crustacés et de mollusques', 'C'),
  n('10.31Z', 'Transformation et conservation de pommes de terre', 'C'),
  n('10.32Z', 'Préparation de jus de fruits et légumes', 'C'),
  n('10.39A', 'Autre transformation et conservation de légumes', 'C'),
  n('10.39B', 'Transformation et conservation de fruits', 'C'),
  n('10.41A', 'Fabrication d’huiles et graisses brutes', 'C'),
  n('10.41B', 'Fabrication d’huiles et graisses raffinées', 'C'),
  n('10.51A', 'Fabrication de lait liquide et de produits frais', 'C'),
  n('10.51B', 'Fabrication de beurre', 'C'),
  n('10.51C', 'Fabrication de fromage', 'C'),
  n('10.61A', 'Meunerie', 'C'),
  n('10.71A', 'Fabrication industrielle de pain et de pâtisserie fraîche', 'C'),
  n('10.71B', 'Cuisson de produits de boulangerie', 'C'),
  n('10.71C', 'Boulangerie et boulangerie-pâtisserie', 'C'),
  n('10.71D', 'Pâtisserie', 'C'),
  n('10.81Z', 'Fabrication de sucre', 'C'),
  n('10.82Z', 'Fabrication de cacao, chocolat et de produits de confiserie', 'C'),
  n('10.85Z', 'Fabrication de plats préparés', 'C'),
  n('10.86Z', 'Fabrication d’aliments homogénéisés et diététiques', 'C'),
  n('10.91Z', 'Fabrication d’aliments pour animaux de ferme', 'C'),
  n('11.01Z', 'Production de boissons alcooliques distillées', 'C'),
  n('11.02A', 'Fabrication de vins effervescents', 'C'),
  n('11.02B', 'Vinification', 'C'),
  n('11.05Z', 'Fabrication de bière', 'C'),
  n('11.07A', 'Industrie des eaux de table', 'C'),
  n('11.07B', 'Production de boissons rafraîchissantes', 'C'),
  n('13.10Z', 'Préparation de fibres textiles et filature', 'C'),
  n('13.20Z', 'Tissage', 'C'),
  n('13.30Z', 'Ennoblissement textile', 'C'),
  n('13.92Z', 'Fabrication d’articles textiles, sauf habillement', 'C'),
  n('14.13Z', 'Fabrication de vêtements de dessus', 'C'),
  n('14.14Z', 'Fabrication de vêtements de dessous', 'C'),
  n('15.11Z', 'Apprêt et tannage des cuirs', 'C'),
  n('15.12Z', 'Fabrication d’articles de voyage, de maroquinerie et de sellerie', 'C'),
  n('15.20Z', 'Fabrication de chaussures', 'C'),
  n('16.10A', 'Sciage et rabotage du bois, hors imprégnation', 'C'),
  n('16.23Z', 'Fabrication de charpentes et d’autres menuiseries', 'C'),
  n('16.24Z', 'Fabrication d’emballages en bois', 'C'),
  n('16.29Z', 'Fabrication d’objets divers en bois ; fabrication d’objets en liège, vannerie et sparterie', 'C'),
  n('17.11Z', 'Fabrication de pâte à papier', 'C'),
  n('17.12Z', 'Fabrication de papier et de carton', 'C'),
  n('17.21A', 'Fabrication de carton ondulé', 'C'),
  n('17.21B', 'Fabrication de cartonnages', 'C'),
  n('17.22Z', 'Fabrication d’articles en papier à usage sanitaire ou domestique', 'C'),
  n('17.23Z', 'Fabrication d’articles de papeterie', 'C'),
  n('18.11Z', 'Imprimerie de journaux', 'C'),
  n('18.12Z', 'Autre imprimerie (labeur)', 'C'),
  n('18.13Z', 'Activités de pré-presse', 'C'),
  n('18.20Z', 'Reproduction d’enregistrements', 'C'),
  n('19.20Z', 'Raffinage du pétrole', 'C'),
  n('20.11Z', 'Fabrication de gaz industriels', 'C'),
  n('20.12Z', 'Fabrication de colorants et de pigments', 'C'),
  n('20.13A', 'Enrichissement et retraitement de matières nucléaires', 'C'),
  n('20.13B', 'Fabrication d’autres produits chimiques inorganiques de base', 'C'),
  n('20.14Z', 'Fabrication d’autres produits chimiques organiques de base', 'C'),
  n('20.15Z', 'Fabrication de produits azotés et d’engrais', 'C'),
  n('20.16Z', 'Fabrication de matières plastiques de base', 'C'),
  n('20.20Z', 'Fabrication de pesticides et d’autres produits agrochimiques', 'C'),
  n('20.30Z', 'Fabrication de peintures, vernis, encres et mastics', 'C'),
  n('20.41Z', 'Fabrication de savons, détergents et produits d’entretien', 'C'),
  n('20.42Z', 'Fabrication de parfums et de produits pour la toilette', 'C'),
  n('20.51Z', 'Fabrication de produits explosifs', 'C'),
  n('20.59Z', 'Fabrication d’autres produits chimiques n.c.a.', 'C'),
  n('21.10Z', 'Fabrication de produits pharmaceutiques de base', 'C'),
  n('21.20Z', 'Fabrication de préparations pharmaceutiques', 'C'),
  n('22.11Z', 'Fabrication et rechapage de pneumatiques', 'C'),
  n('22.19Z', 'Fabrication d’autres articles en caoutchouc', 'C'),
  n('22.21Z', 'Fabrication de plaques, feuilles, tubes et profilés en matières plastiques', 'C'),
  n('22.22Z', 'Fabrication d’emballages en matières plastiques', 'C'),
  n('22.23Z', 'Fabrication d’éléments en matières plastiques pour la construction', 'C'),
  n('22.29A', 'Fabrication de pièces techniques à base de matières plastiques', 'C'),
  n('23.11Z', 'Fabrication de verre plat', 'C'),
  n('23.13Z', 'Fabrication de verre creux', 'C'),
  n('23.19Z', 'Fabrication et façonnage d’autres articles en verre, y compris verre technique', 'C'),
  n('23.20Z', 'Fabrication de produits réfractaires', 'C'),
  n('23.31Z', 'Fabrication de carreaux en céramique', 'C'),
  n('23.32Z', 'Fabrication de briques, tuiles et produits de construction en terre cuite', 'C'),
  n('23.51Z', 'Fabrication de ciment', 'C'),
  n('23.52Z', 'Fabrication de chaux et plâtre', 'C'),
  n('23.61Z', 'Fabrication d’éléments en béton pour la construction', 'C'),
  n('23.63Z', 'Fabrication de béton prêt à l’emploi', 'C'),
  n('23.64Z', 'Fabrication de mortiers et bétons secs', 'C'),
  n('23.70Z', 'Taille, façonnage et finissage de pierres', 'C'),
  n('24.10Z', 'Sidérurgie', 'C'),
  n('24.20Z', 'Fabrication de tubes, tuyaux, profilés creux et accessoires correspondants en acier', 'C'),
  n('24.42Z', 'Métallurgie de l’aluminium', 'C'),
  n('24.43Z', 'Métallurgie du plomb, du zinc ou de l’étain', 'C'),
  n('24.44Z', 'Métallurgie du cuivre', 'C'),
  n('24.45Z', 'Métallurgie des autres métaux non ferreux', 'C'),
  n('24.51Z', 'Fonderie de fonte', 'C'),
  n('24.52Z', 'Fonderie d’acier', 'C'),
  n('25.11Z', 'Fabrication de structures métalliques et de parties de structures', 'C'),
  n('25.12Z', 'Fabrication de portes et fenêtres en métal', 'C'),
  n('25.21Z', 'Fabrication de radiateurs et de chaudières pour le chauffage central', 'C'),
  n('25.29Z', 'Fabrication d’autres réservoirs, citernes et conteneurs métalliques', 'C'),
  n('25.50A', 'Forge, estampage, matriçage ; métallurgie des poudres', 'C'),
  n('25.50B', 'Découpage, emboutissage', 'C'),
  n('25.61Z', 'Traitement et revêtement des métaux', 'C'),
  n('25.62A', 'Décolletage', 'C'),
  n('25.62B', 'Mécanique industrielle', 'C'),
  n('25.71Z', 'Fabrication de coutellerie', 'C'),
  n('25.72Z', 'Fabrication de serrures et de ferrures', 'C'),
  n('25.73A', 'Fabrication de moules et modèles', 'C'),
  n('25.73B', 'Fabrication d’autres outillages', 'C'),
  n('25.91Z', 'Fabrication de fûts et emballages métalliques similaires', 'C'),
  n('25.93Z', 'Fabrication d’articles en fils métalliques, de chaînes et de ressorts', 'C'),
  n('25.94Z', 'Fabrication de vis et de boulons', 'C'),
  n('25.99A', 'Fabrication d’articles métalliques ménagers', 'C'),
  n('25.99B', 'Fabrication d’autres articles métalliques', 'C'),
  n('26.11Z', 'Fabrication de composants électroniques', 'C'),
  n('26.12Z', 'Fabrication de cartes électroniques assemblées', 'C'),
  n('26.20Z', 'Fabrication d’ordinateurs et d’équipements périphériques', 'C'),
  n('26.30Z', 'Fabrication d’équipements de communication', 'C'),
  n('26.40Z', 'Fabrication de produits électroniques grand public', 'C'),
  n('26.51A', 'Fabrication d’équipements d’aide à la navigation', 'C'),
  n('26.51B', 'Fabrication d’instrumentation scientifique et technique', 'C'),
  n('26.60Z', 'Fabrication d’équipements d’irradiation médicale, d’équipements électromédicaux et électrothérapeutiques', 'C'),
  n('27.11Z', 'Fabrication de moteurs, génératrices et transformateurs électriques', 'C'),
  n('27.12Z', 'Fabrication de matériel de distribution et de commande électrique', 'C'),
  n('27.20Z', 'Fabrication de piles et d’accumulateurs électriques', 'C'),
  n('27.31Z', 'Fabrication de câbles de fibres optiques', 'C'),
  n('27.32Z', 'Fabrication d’autres fils et câbles électroniques ou électriques', 'C'),
  n('27.33Z', 'Fabrication de matériel d’installation électrique', 'C'),
  n('27.40Z', 'Fabrication d’appareils d’éclairage électrique', 'C'),
  n('27.51Z', 'Fabrication d’appareils électroménagers', 'C'),
  n('28.11Z', 'Fabrication de moteurs et turbines, à l’exception des moteurs d’avions et de véhicules', 'C'),
  n('28.12Z', 'Fabrication d’équipements hydrauliques et pneumatiques', 'C'),
  n('28.13Z', 'Fabrication d’autres pompes et compresseurs', 'C'),
  n('28.14Z', 'Fabrication d’autres articles de robinetterie', 'C'),
  n('28.15Z', 'Fabrication d’engrenages et d’organes mécaniques de transmission', 'C'),
  n('28.22Z', 'Fabrication de matériel de levage et de manutention', 'C'),
  n('28.23Z', 'Fabrication de machines et d’équipements de bureau (à l’exception des ordinateurs et équipements périphériques)', 'C'),
  n('28.24Z', 'Fabrication d’outillage portatif à moteur incorporé', 'C'),
  n('28.25Z', 'Fabrication d’équipements aérauliques et frigorifiques industriels', 'C'),
  n('28.29A', 'Fabrication d’équipements d’emballage, de conditionnement et de pesage', 'C'),
  n('28.29B', 'Fabrication d’autres machines d’usage général', 'C'),
  n('28.30Z', 'Fabrication de machines agricoles et forestières', 'C'),
  n('28.41Z', 'Fabrication de machines-outils pour le travail des métaux', 'C'),
  n('28.92Z', 'Fabrication de machines pour l’extraction ou la construction', 'C'),
  n('28.93Z', 'Fabrication de machines pour l’industrie agro-alimentaire', 'C'),
  n('28.94Z', 'Fabrication de machines pour les industries textiles', 'C'),
  n('28.96Z', 'Fabrication de machines pour le travail du caoutchouc ou des plastiques', 'C'),
  n('29.10Z', 'Construction de véhicules automobiles', 'C'),
  n('29.20Z', 'Fabrication de carrosseries et remorques', 'C'),
  n('29.31Z', 'Fabrication d’équipements électriques et électroniques automobiles', 'C'),
  n('29.32Z', 'Fabrication d’autres équipements automobiles', 'C'),
  n('30.11Z', 'Construction de navires et de structures flottantes', 'C'),
  n('30.20Z', 'Construction de locomotives et d’autre matériel ferroviaire roulant', 'C'),
  n('30.30Z', 'Construction aéronautique et spatiale', 'C'),
  n('30.91Z', 'Fabrication de motocycles', 'C'),
  n('30.92Z', 'Fabrication de bicyclettes et de véhicules pour invalides', 'C'),
  n('31.01Z', 'Fabrication de meubles de bureau et de magasin', 'C'),
  n('31.02Z', 'Fabrication de meubles de cuisine', 'C'),
  n('31.09A', 'Fabrication de sièges d’ameublement d’intérieur', 'C'),
  n('31.09B', 'Fabrication d’autres meubles et industries connexes de l’ameublement', 'C'),
  n('32.50A', 'Fabrication de matériel médico-chirurgical et dentaire', 'C'),
  n('32.99Z', 'Autres activités manufacturières n.c.a.', 'C'),
  n('33.11Z', 'Réparation d’ouvrages en métaux', 'C'),
  n('33.12Z', 'Réparation de machines et équipements mécaniques', 'C'),
  n('33.13Z', 'Réparation de matériels électroniques et optiques', 'C'),
  n('33.14Z', 'Réparation d’équipements électriques', 'C'),
  n('33.20A', "Installation de structures métalliques, chaudronnées et de tuyauterie", 'C'),
  n('33.20B', "Installation de machines et équipements mécaniques", 'C'),

  // ── Section D — Énergie ───────────────────────────────────
  n('35.11Z', "Production d'électricité", 'D'),
  n('35.12Z', "Transport d'électricité", 'D'),
  n('35.13Z', "Distribution d'électricité", 'D'),
  n('35.14Z', "Commerce d'électricité", 'D'),
  n('35.21Z', 'Production de combustibles gazeux', 'D'),
  n('35.22Z', 'Distribution de combustibles gazeux par conduites', 'D'),
  n('35.30Z', 'Production et distribution de vapeur et d’air conditionné', 'D'),

  // ── Section E — Eau et déchets ────────────────────────────
  n('36.00Z', 'Captage, traitement et distribution d’eau', 'E'),
  n('37.00Z', 'Collecte et traitement des eaux usées', 'E'),
  n('38.11Z', 'Collecte des déchets non dangereux', 'E'),
  n('38.12Z', 'Collecte des déchets dangereux', 'E'),
  n('38.21Z', 'Traitement et élimination des déchets non dangereux', 'E'),
  n('38.22Z', 'Traitement et élimination des déchets dangereux', 'E'),
  n('38.32Z', 'Récupération de déchets triés', 'E'),
  n('39.00Z', 'Dépollution et autres services de gestion des déchets', 'E'),

  // ── Section F — Construction ──────────────────────────────
  n('41.10A', 'Promotion immobilière de logements', 'F'),
  n('41.10B', 'Promotion immobilière de bureaux', 'F'),
  n('41.10C', 'Promotion immobilière d’autres bâtiments', 'F'),
  n('41.20A', 'Construction de maisons individuelles', 'F'),
  n('41.20B', 'Construction d’autres bâtiments', 'F'),
  n('42.11Z', 'Construction de routes et autoroutes', 'F'),
  n('42.12Z', 'Construction de voies ferrées de surface et souterraines', 'F'),
  n('42.13A', "Construction d'ouvrages d'art", 'F'),
  n('42.13B', 'Construction et entretien de tunnels', 'F'),
  n('42.21Z', 'Construction de réseaux pour fluides', 'F'),
  n('42.22Z', 'Construction de réseaux électriques et de télécommunications', 'F'),
  n('42.91Z', 'Construction d’ouvrages maritimes et fluviaux', 'F'),
  n('42.99Z', 'Construction d’autres ouvrages de génie civil n.c.a.', 'F'),
  n('43.11Z', 'Travaux de démolition', 'F'),
  n('43.12A', 'Travaux de terrassement courants et travaux préparatoires', 'F'),
  n('43.12B', 'Travaux de terrassement spécialisés ou de grande masse', 'F'),
  n('43.13Z', 'Forages et sondages', 'F'),
  n('43.21A', 'Travaux d’installation électrique dans tous locaux', 'F'),
  n('43.21B', 'Travaux d’installation électrique sur la voie publique', 'F'),
  n('43.22A', 'Travaux d’installation d’eau et de gaz en tous locaux', 'F'),
  n('43.22B', 'Travaux d’installation d’équipements thermiques et de climatisation', 'F'),
  n('43.29A', 'Travaux d’isolation', 'F'),
  n('43.29B', 'Autres travaux d’installation n.c.a.', 'F'),
  n('43.31Z', 'Travaux de plâtrerie', 'F'),
  n('43.32A', 'Travaux de menuiserie bois et PVC', 'F'),
  n('43.32B', 'Travaux de menuiserie métallique et serrurerie', 'F'),
  n('43.32C', "Agencement de lieux de vente", 'F'),
  n('43.33Z', 'Travaux de revêtement des sols et des murs', 'F'),
  n('43.34Z', 'Travaux de peinture et vitrerie', 'F'),
  n('43.39Z', 'Autres travaux de finition', 'F'),
  n('43.91A', 'Travaux de charpente', 'F'),
  n('43.91B', 'Travaux de couverture par éléments', 'F'),
  n('43.99A', "Travaux d'étanchéification", 'F'),
  n('43.99B', 'Travaux de montage de structures métalliques', 'F'),
  n('43.99C', "Travaux de maçonnerie générale et gros œuvre de bâtiment", 'F'),
  n('43.99D', "Autres travaux spécialisés de construction", 'F'),
  n('43.99E', "Location avec opérateur de matériel de construction", 'F'),

  // ── Section G — Commerce ──────────────────────────────────
  n('45.11Z', 'Commerce de voitures et de véhicules automobiles légers', 'G'),
  n('45.19Z', 'Commerce d’autres véhicules automobiles', 'G'),
  n('45.20A', 'Entretien et réparation de véhicules automobiles légers', 'G'),
  n('45.20B', 'Entretien et réparation d’autres véhicules automobiles', 'G'),
  n('45.31Z', 'Commerce de gros d’équipements automobiles', 'G'),
  n('45.32Z', 'Commerce de détail d’équipements automobiles', 'G'),
  n('45.40Z', 'Commerce et réparation de motocycles', 'G'),
  n('46.11Z', 'Intermédiaires du commerce en matières premières agricoles, animaux vivants, matières premières textiles et produits semi-finis', 'G'),
  n('46.17A', 'Centrales d’achat alimentaires', 'G'),
  n('46.17B', 'Autres intermédiaires du commerce en denrées, boissons et tabac', 'G'),
  n('46.18Z', 'Intermédiaires spécialisés du commerce en autres produits spécifiques', 'G'),
  n('46.19A', "Centrales d'achat non alimentaires", 'G'),
  n('46.19B', "Autres intermédiaires du commerce en produits divers", 'G'),
  n('46.21Z', 'Commerce de gros de céréales, de tabac non manufacturé, de semences et d’aliments pour le bétail', 'G'),
  n('46.31Z', 'Commerce de gros de fruits et légumes', 'G'),
  n('46.32A', 'Commerce de gros de viandes de boucherie', 'G'),
  n('46.33Z', 'Commerce de gros de produits laitiers, œufs, huiles et matières grasses comestibles', 'G'),
  n('46.34Z', 'Commerce de gros de boissons', 'G'),
  n('46.35Z', 'Commerce de gros de produits à base de tabac', 'G'),
  n('46.36Z', 'Commerce de gros de sucre, chocolat et confiserie', 'G'),
  n('46.37Z', 'Commerce de gros de café, thé, cacao et épices', 'G'),
  n('46.38A', 'Commerce de gros de poissons, crustacés et mollusques', 'G'),
  n('46.39A', 'Commerce de gros alimentaire spécialisé divers', 'G'),
  n('46.39B', 'Commerce de gros alimentaire non spécialisé', 'G'),
  n('46.41Z', 'Commerce de gros de textiles', 'G'),
  n('46.42Z', "Commerce de gros d'habillement et de chaussures", 'G'),
  n('46.43Z', "Commerce de gros d'appareils électroménagers", 'G'),
  n('46.46Z', 'Commerce de gros de produits pharmaceutiques', 'G'),
  n('46.49Z', 'Commerce de gros d’autres biens domestiques', 'G'),
  n('46.51Z', 'Commerce de gros d’ordinateurs, équipements informatiques périphériques et logiciels', 'G'),
  n('46.52Z', 'Commerce de gros de composants et d’équipements électroniques et de télécommunication', 'G'),
  n('46.61Z', 'Commerce de gros de matériel agricole', 'G'),
  n('46.62Z', 'Commerce de gros de machines-outils', 'G'),
  n('46.63Z', 'Commerce de gros de machines pour l’extraction, la construction et le génie civil', 'G'),
  n('46.69A', "Commerce de gros de matériel électrique", 'G'),
  n('46.69B', "Commerce de gros de fournitures et équipements industriels divers", 'G'),
  n('46.69C', "Commerce de gros de fournitures et équipements divers pour le commerce et les services", 'G'),
  n('46.71Z', 'Commerce de gros de combustibles et de produits annexes', 'G'),
  n('46.72Z', 'Commerce de gros de minerais et métaux', 'G'),
  n('46.73A', "Commerce de gros de bois et de matériaux de construction", 'G'),
  n('46.73B', "Commerce de gros d'appareils sanitaires et de produits de décoration", 'G'),
  n('46.74A', "Commerce de gros de quincaillerie", 'G'),
  n('46.74B', "Commerce de gros de fournitures pour la plomberie et le chauffage", 'G'),
  n('46.75Z', 'Commerce de gros de produits chimiques', 'G'),
  n('46.76Z', 'Commerce de gros d’autres produits intermédiaires', 'G'),
  n('46.90Z', 'Commerce de gros non spécialisé', 'G'),
  n('47.11A', "Commerce de détail de produits surgelés", 'G'),
  n('47.11B', 'Commerce d’alimentation générale', 'G'),
  n('47.11C', 'Supérettes', 'G'),
  n('47.11D', 'Supermarchés', 'G'),
  n('47.11E', 'Magasins multi-commerces', 'G'),
  n('47.11F', 'Hypermarchés', 'G'),
  n('47.19A', 'Grands magasins', 'G'),
  n('47.19B', 'Autres commerces de détail en magasin non spécialisé', 'G'),
  n('47.22Z', 'Commerce de détail de viandes et de produits à base de viande en magasin spécialisé', 'G'),
  n('47.24Z', "Commerce de détail de pain, pâtisserie et confiserie en magasin spécialisé", 'G'),
  n('47.25Z', 'Commerce de détail de boissons en magasin spécialisé', 'G'),
  n('47.30Z', 'Commerce de détail de carburants en magasin spécialisé', 'G'),
  n('47.43Z', "Commerce de détail de matériels audio et vidéo en magasin spécialisé", 'G'),
  n('47.52A', "Commerce de détail de quincaillerie, peintures et verres en petites surfaces", 'G'),
  n('47.52B', "Commerce de détail de quincaillerie, peintures et verres en grandes surfaces", 'G'),
  n('47.71Z', 'Commerce de détail d’habillement en magasin spécialisé', 'G'),
  n('47.72A', 'Commerce de détail de la chaussure', 'G'),
  n('47.72B', "Commerce de détail de maroquinerie et d'articles de voyage", 'G'),
  n('47.73Z', 'Commerce de détail de produits pharmaceutiques en magasin spécialisé', 'G'),
  n('47.74Z', "Commerce de détail d'articles médicaux et orthopédiques en magasin spécialisé", 'G'),
  n('47.78A', 'Commerces de détail d’optique', 'G'),
  n('47.78B', "Commerces de détail de charbons et combustibles", 'G'),
  n('47.78C', "Autres commerces de détail spécialisés divers", 'G'),

  // ── Section H — Transports et entreposage ─────────────────
  n('49.10Z', 'Transport ferroviaire interurbain de voyageurs', 'H'),
  n('49.20Z', 'Transports ferroviaires de fret', 'H'),
  n('49.31Z', 'Transports urbains et suburbains de voyageurs', 'H'),
  n('49.32Z', 'Transports de voyageurs par taxis', 'H'),
  n('49.39A', 'Transports routiers réguliers de voyageurs', 'H'),
  n('49.39B', "Autres transports routiers de voyageurs", 'H'),
  n('49.41A', 'Transports routiers de fret interurbains', 'H'),
  n('49.41B', 'Transports routiers de fret de proximité', 'H'),
  n('49.42Z', 'Services de déménagement', 'H'),
  n('49.50Z', 'Transports par conduites', 'H'),
  n('50.10Z', 'Transports maritimes et côtiers de passagers', 'H'),
  n('50.20Z', 'Transports maritimes et côtiers de fret', 'H'),
  n('50.40Z', 'Transports fluviaux de fret', 'H'),
  n('51.10Z', 'Transports aériens de passagers', 'H'),
  n('51.21Z', 'Transports aériens de fret', 'H'),
  n('52.10A', 'Entreposage et stockage frigorifique', 'H'),
  n('52.10B', 'Entreposage et stockage non frigorifique', 'H'),
  n('52.21Z', 'Services auxiliaires des transports terrestres', 'H'),
  n('52.22Z', 'Services auxiliaires des transports par eau', 'H'),
  n('52.23Z', 'Services auxiliaires des transports aériens', 'H'),
  n('52.24A', 'Manutention portuaire', 'H'),
  n('52.24B', 'Manutention non portuaire', 'H'),
  n('52.29A', 'Messagerie, fret express', 'H'),
  n('52.29B', "Affrètement et organisation des transports", 'H'),
  n('53.10Z', "Activités de poste dans le cadre d'une obligation de service universel", 'H'),
  n('53.20Z', "Autres activités de poste et de courrier", 'H'),

  // ── Section I — Hébergement et restauration ───────────────
  n('55.10Z', 'Hôtels et hébergement similaire', 'I'),
  n('55.20Z', 'Hébergement touristique et autre hébergement de courte durée', 'I'),
  n('55.30Z', 'Terrains de camping et parcs pour caravanes ou véhicules de loisirs', 'I'),
  n('56.10A', 'Restauration traditionnelle', 'I'),
  n('56.10B', "Cafétérias et autres libres-services", 'I'),
  n('56.10C', "Restauration de type rapide", 'I'),
  n('56.21Z', "Services des traiteurs", 'I'),
  n('56.29A', "Restauration collective sous contrat", 'I'),
  n('56.29B', "Autres services de restauration n.c.a.", 'I'),
  n('56.30Z', 'Débits de boissons', 'I'),

  // ── Section J — Information et communication ─────────────
  n('58.11Z', 'Édition de livres', 'J'),
  n('58.13Z', 'Édition de journaux', 'J'),
  n('58.14Z', 'Édition de revues et périodiques', 'J'),
  n('58.21Z', 'Édition de jeux électroniques', 'J'),
  n('58.29A', "Édition de logiciels système et de réseau", 'J'),
  n('58.29B', "Édition de logiciels outils de développement et de langages", 'J'),
  n('58.29C', "Édition de logiciels applicatifs", 'J'),
  n('59.11A', 'Production de films et de programmes pour la télévision', 'J'),
  n('59.11B', 'Production de films institutionnels et publicitaires', 'J'),
  n('59.11C', 'Production de films pour le cinéma', 'J'),
  n('59.20Z', 'Enregistrement sonore et édition musicale', 'J'),
  n('60.10Z', 'Édition et diffusion de programmes radio', 'J'),
  n('60.20A', "Édition de chaînes généralistes", 'J'),
  n('60.20B', "Édition de chaînes thématiques", 'J'),
  n('61.10Z', "Télécommunications filaires", 'J'),
  n('61.20Z', "Télécommunications sans fil", 'J'),
  n('61.30Z', "Télécommunications par satellite", 'J'),
  n('61.90Z', "Autres activités de télécommunication", 'J'),
  n('62.01Z', 'Programmation informatique', 'J'),
  n('62.02A', 'Conseil en systèmes et logiciels informatiques', 'J'),
  n('62.02B', "Tierce maintenance de systèmes et d'applications informatiques", 'J'),
  n('62.03Z', "Gestion d'installations informatiques", 'J'),
  n('62.09Z', 'Autres activités informatiques', 'J'),
  n('63.11Z', 'Traitement de données, hébergement et activités connexes', 'J'),
  n('63.12Z', 'Portails internet', 'J'),
  n('63.91Z', 'Activités des agences de presse', 'J'),
  n('63.99Z', 'Autres services d’information n.c.a.', 'J'),

  // ── Section K — Activités financières et d'assurance ──────
  n('64.11Z', 'Activités de banque centrale', 'K'),
  n('64.19Z', 'Autres intermédiations monétaires', 'K'),
  n('64.20Z', 'Activités des sociétés holding', 'K'),
  n('64.30Z', 'Fonds de placement et entités financières similaires', 'K'),
  n('64.91Z', 'Crédit-bail', 'K'),
  n('64.92Z', "Autre distribution de crédit", 'K'),
  n('64.99Z', "Autres activités des services financiers, hors assurance et caisses de retraite, n.c.a.", 'K'),
  n('65.11Z', 'Assurance vie', 'K'),
  n('65.12Z', 'Autres assurances', 'K'),
  n('65.20Z', 'Réassurance', 'K'),
  n('65.30Z', 'Caisses de retraite', 'K'),
  n('66.12Z', 'Courtage de valeurs mobilières et de marchandises', 'K'),
  n('66.19A', 'Supports juridiques de gestion de patrimoine mobilier', 'K'),
  n('66.19B', "Autres activités auxiliaires de services financiers, hors assurance et caisses de retraite, n.c.a.", 'K'),
  n('66.21Z', "Évaluation des risques et dommages", 'K'),
  n('66.22Z', "Activités des agents et courtiers d'assurances", 'K'),
  n('66.29Z', "Autres activités auxiliaires d'assurance et de caisses de retraite", 'K'),
  n('66.30Z', 'Gestion de fonds', 'K'),

  // ── Section L — Activités immobilières ────────────────────
  n('68.10Z', "Activités des marchands de biens immobiliers", 'L'),
  n('68.20A', 'Location de logements', 'L'),
  n('68.20B', "Location de terrains et d'autres biens immobiliers", 'L'),
  n('68.31Z', "Agences immobilières", 'L'),
  n('68.32A', "Administration d'immeubles et autres biens immobiliers", 'L'),
  n('68.32B', "Supports juridiques de gestion de patrimoine immobilier", 'L'),

  // ── Section M — Activités spécialisées, scientifiques et techniques ─
  n('69.10Z', "Activités juridiques", 'M'),
  n('69.20Z', 'Activités comptables', 'M'),
  n('70.10Z', "Activités des sièges sociaux", 'M'),
  n('70.21Z', "Conseil en relations publiques et communication", 'M'),
  n('70.22Z', "Conseil pour les affaires et autres conseils de gestion", 'M'),
  n('71.11Z', "Activités d'architecture", 'M'),
  n('71.12A', "Activité des géomètres", 'M'),
  n('71.12B', 'Ingénierie, études techniques', 'M'),
  n('71.20A', "Contrôle technique automobile", 'M'),
  n('71.20B', 'Analyses, essais et inspections techniques', 'M'),
  n('72.11Z', "Recherche-développement en biotechnologie", 'M'),
  n('72.19Z', "Recherche-développement en autres sciences physiques et naturelles", 'M'),
  n('72.20Z', "Recherche-développement en sciences humaines et sociales", 'M'),
  n('73.11Z', "Activités des agences de publicité", 'M'),
  n('73.12Z', 'Régie publicitaire de médias', 'M'),
  n('73.20Z', "Études de marché et sondages", 'M'),
  n('74.10Z', 'Activités spécialisées de design', 'M'),
  n('74.20Z', "Activités photographiques", 'M'),
  n('74.30Z', "Traduction et interprétation", 'M'),
  n('74.90A', "Activités des économistes de la construction", 'M'),
  n('74.90B', "Activités spécialisées, scientifiques et techniques diverses", 'M'),
  n('75.00Z', "Activités vétérinaires", 'M'),

  // ── Section N — Services administratifs et de soutien ─────
  n('77.11A', 'Location de courte durée de voitures et de véhicules automobiles légers', 'N'),
  n('77.11B', 'Location de longue durée de voitures et de véhicules automobiles légers', 'N'),
  n('77.12Z', 'Location et location-bail de camions', 'N'),
  n('77.32Z', 'Location et location-bail de machines et équipements pour la construction', 'N'),
  n('77.39Z', "Location et location-bail d'autres machines, équipements et biens matériels", 'N'),
  n('78.10Z', "Activités des agences de placement de main-d'œuvre", 'N'),
  n('78.20Z', 'Activités des agences de travail temporaire', 'N'),
  n('78.30Z', 'Autre mise à disposition de ressources humaines', 'N'),
  n('79.11Z', 'Activités des agences de voyage', 'N'),
  n('79.12Z', "Activités des voyagistes", 'N'),
  n('80.10Z', "Activités de sécurité privée", 'N'),
  n('80.20Z', 'Activités liées aux systèmes de sécurité', 'N'),
  n('80.30Z', "Activités d'enquête", 'N'),
  n('81.10Z', 'Activités combinées de soutien lié aux bâtiments', 'N'),
  n('81.21Z', 'Nettoyage courant des bâtiments', 'N'),
  n('81.22Z', "Autres activités de nettoyage des bâtiments et nettoyage industriel", 'N'),
  n('81.29A', "Désinfection, désinsectisation, dératisation", 'N'),
  n('81.29B', "Autres activités de nettoyage n.c.a.", 'N'),
  n('81.30Z', "Services d'aménagement paysager", 'N'),
  n('82.11Z', 'Services administratifs combinés de bureau', 'N'),
  n('82.19Z', "Photocopie, préparation de documents et autres activités spécialisées de soutien de bureau", 'N'),
  n('82.20Z', "Activités de centres d'appels", 'N'),
  n('82.30Z', 'Organisation de salons professionnels et congrès', 'N'),
  n('82.91Z', "Activités des agences de recouvrement de factures et des sociétés d'information financière sur la clientèle", 'N'),
  n('82.92Z', "Activités de conditionnement", 'N'),
  n('82.99Z', 'Autres activités de soutien aux entreprises n.c.a.', 'N'),

  // ── Section P — Enseignement ──────────────────────────────
  n('85.10Z', 'Enseignement pré-primaire', 'P'),
  n('85.20Z', 'Enseignement primaire', 'P'),
  n('85.31Z', 'Enseignement secondaire général', 'P'),
  n('85.32Z', 'Enseignement secondaire technique ou professionnel', 'P'),
  n('85.41Z', 'Enseignement post-secondaire non supérieur', 'P'),
  n('85.42Z', 'Enseignement supérieur', 'P'),
  n('85.59A', 'Formation continue d’adultes', 'P'),
  n('85.59B', 'Autres enseignements', 'P'),
  n('85.60Z', "Activités de soutien à l'enseignement", 'P'),

  // ── Section Q — Santé humaine et action sociale ───────────
  n('86.10Z', 'Activités hospitalières', 'Q'),
  n('86.21Z', 'Activité des médecins généralistes', 'Q'),
  n('86.22A', 'Activités de radiodiagnostic et de radiothérapie', 'Q'),
  n('86.22B', 'Activités chirurgicales', 'Q'),
  n('86.22C', "Autres activités des médecins spécialistes", 'Q'),
  n('86.23Z', "Pratique dentaire", 'Q'),
  n('86.90A', "Ambulances", 'Q'),
  n('86.90B', "Laboratoires d'analyses médicales", 'Q'),
  n('86.90C', "Centres de collecte et banques d'organes", 'Q'),
  n('86.90D', 'Activités des infirmiers et des sages-femmes', 'Q'),
  n('86.90E', 'Activités des professionnels de la rééducation, de l’appareillage et des pédicures-podologues', 'Q'),
  n('86.90F', 'Activités de santé humaine non classées ailleurs', 'Q'),
  n('87.10A', "Hébergement médicalisé pour personnes âgées", 'Q'),
  n('87.10B', "Hébergement médicalisé pour enfants handicapés", 'Q'),
  n('87.20A', "Hébergement social pour handicapés mentaux et malades mentaux", 'Q'),
  n('87.30A', "Hébergement social pour personnes âgées", 'Q'),
  n('87.30B', "Hébergement social pour handicapés physiques", 'Q'),
  n('88.10A', "Aide à domicile", 'Q'),
  n('88.10B', "Accueil ou accompagnement sans hébergement d'adultes handicapés ou de personnes âgées", 'Q'),
  n('88.91A', "Accueil de jeunes enfants", 'Q'),

  // ── Section R — Arts, spectacles ──────────────────────────
  n('90.01Z', "Arts du spectacle vivant", 'R'),
  n('90.02Z', "Activités de soutien au spectacle vivant", 'R'),
  n('90.03A', "Création artistique relevant des arts plastiques", 'R'),
  n('90.04Z', "Gestion de salles de spectacles", 'R'),
  n('91.02Z', 'Gestion des musées', 'R'),
  n('92.00Z', "Organisation de jeux de hasard et d'argent", 'R'),
  n('93.11Z', 'Gestion d’installations sportives', 'R'),
  n('93.12Z', 'Activités de clubs de sports', 'R'),
  n('93.13Z', "Activités des centres de culture physique", 'R'),
  n('93.21Z', "Activités des parcs d'attractions et parcs à thèmes", 'R'),
  n('93.29Z', "Autres activités récréatives et de loisirs", 'R'),

  // ── Section S — Autres activités de services ──────────────
  n('94.11Z', "Activités des organisations patronales et consulaires", 'S'),
  n('94.12Z', 'Activités des organisations professionnelles', 'S'),
  n('94.20Z', 'Activités des syndicats de salariés', 'S'),
  n('95.11Z', "Réparation d'ordinateurs et d'équipements périphériques", 'S'),
  n('95.12Z', "Réparation d'équipements de communication", 'S'),
  n('95.21Z', "Réparation de produits électroniques grand public", 'S'),
  n('95.22Z', "Réparation d'appareils électroménagers et d'équipements pour la maison et le jardin", 'S'),
  n('95.23Z', "Réparation de chaussures et d'articles en cuir", 'S'),
  n('95.24Z', "Réparation de meubles et d'équipements du foyer", 'S'),
  n('95.25Z', "Réparation d'articles d'horlogerie et de bijouterie", 'S'),
  n('96.01A', 'Blanchisserie-teinturerie de gros', 'S'),
  n('96.01B', 'Blanchisserie-teinturerie de détail', 'S'),
  n('96.02A', 'Coiffure', 'S'),
  n('96.02B', "Soins de beauté", 'S'),
  n('96.03Z', 'Services funéraires', 'S'),
  n('96.04Z', 'Entretien corporel', 'S'),
  n('96.09Z', "Autres services personnels n.c.a.", 'S'),
] as const

/**
 * Set des codes NAF prioritaires (cf. NAF_GROUPS_SUGGESTED), précalculé pour
 * lookup O(1) côté UI ("appartient au groupe suggéré ?").
 */
export const SUGGESTED_NAF_CODES: ReadonlySet<string> = new Set(
  NAF_GROUPS_SUGGESTED.flatMap((g) => g.codes),
)

/**
 * Normalise une chaîne pour la recherche : casse + accents ignorés.
 * Utilisée pour le matching côté UI (filter input) — symétrique côté
 * code et libellé.
 */
export function normalizeSearchString(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/**
 * Index normalisé pour la recherche (memoïsable côté composant si besoin).
 * Pré-calcule la version normalisée du code et du libellé pour matcher
 * en `includes()` rapidement.
 */
export interface NafCodeSearchEntry extends NafCode {
  /** code + libellé normalisés pour recherche. */
  _haystack: string
}

export const NAF_CODES_SEARCH: readonly NafCodeSearchEntry[] = NAF_CODES.map(
  (c) => ({
    ...c,
    _haystack: `${normalizeSearchString(c.code)} ${normalizeSearchString(c.libelle)}`,
  }),
)
