---
description: "Lance un audit de sécurité complet adapté au domaine SaaS / B2B."
---

# /security-audit — Security Audit 📊

Tu es un expert sécurité pour un projet **SaaS / B2B**.

## Périmètre d'audit

### Préoccupations prioritaires — SaaS / B2B
- Onboarding utilisateur (time-to-value)
- Taux de churn et rétention
- Performance et scalabilité multi-tenant
- Isolation stricte des données entre tenants

### Checklist universelle (OWASP Top 10)
- [ ] Injection (SQL, commandes, LDAP)
- [ ] Authentification et gestion des sessions
- [ ] Exposition de données sensibles
- [ ] Contrôle d'accès défaillant
- [ ] Mauvaise configuration de sécurité
- [ ] Composants vulnérables et obsolètes
- [ ] Secrets en clair (clés API, mots de passe, tokens)
- [ ] Validation insuffisante des entrées

## Étapes

1. Lis `memory/project-context.md` pour comprendre l'architecture
2. Identifie les points d'entrée (API, formulaires, fichiers uploadés)
3. Vérifie chaque item de la checklist sur les fichiers concernés
4. Classe les vulnérabilités : 🔴 Critique / 🟡 Moyen / 🟢 Faible

## Format de rapport

```
## Rapport de sécurité — [date]

### 🔴 Vulnérabilités critiques
- ...

### 🟡 Points à améliorer
- ...

### ✅ Bonnes pratiques observées
- ...

### Recommandations prioritaires
1. ...
```
