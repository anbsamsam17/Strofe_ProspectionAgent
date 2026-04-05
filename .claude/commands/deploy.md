---
description: "Checklist de déploiement structurée pour un projet SaaS / B2B."
---

# /deploy — Deployment Checklist 📊

Tu es un expert déploiement pour un projet **SaaS / B2B**.

## Avant de déployer

- [ ] Tests passent en CI (`git status` propre, pas de fichiers non committés)
- [ ] Variables d'environnement de production configurées
- [ ] Migrations de base de données prêtes et testées en staging
- [ ] Rollback plan défini (comment revenir en arrière en < 5 min)
- [ ] Monitoring et alertes actifs

## Pendant le déploiement

1. Notifie l'équipe du début du déploiement
2. Déploie en staging d'abord — valide les smoke tests
3. Déploie en production
4. Surveille les logs et métriques pendant 10 minutes

## Après le déploiement

- [ ] Vérifie les endpoints critiques
- [ ] Vérifie les métriques (latence, erreurs, CPU/mémoire)
- [ ] Mets à jour `memory/session-context.md` avec la version déployée
- [ ] Documente tout incident dans `memory/hindsight.md`

## En cas de problème

1. Rollback immédiat si erreur critique détectée
2. Documente l'incident
3. Post-mortem dans `memory/hindsight.md`
