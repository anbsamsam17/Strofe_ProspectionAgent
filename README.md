# Agent de Prospection - Bilan Carbone

Un agent IA de prospection commerciale spécialisé dans les services de **bilan carbone**.  
Il génère automatiquement des messages personnalisés pour chaque prospect en s'appuyant sur les modèles de langage d'OpenAI.

---

## Fonctionnalités

- Génération de messages de prospection personnalisés par secteur d'activité
- Intégration avec l'API OpenAI (GPT-4o par défaut)
- Configuration simple via variables d'environnement
- Structure modulaire et extensible

---

## Prérequis

- Python 3.10+
- Une clé API OpenAI valide

---

## Installation

```bash
# 1. Cloner le dépôt
git clone https://github.com/anbsamsam17/Strofe_ProspectionAgent.git
cd Strofe_ProspectionAgent

# 2. Créer et activer un environnement virtuel
python -m venv venv
source venv/bin/activate   # Windows : venv\Scripts\activate

# 3. Installer les dépendances
pip install -r requirements.txt

# 4. Configurer les variables d'environnement
cp .env.example .env
# Éditez .env et renseignez votre OPENAI_API_KEY
```

---

## Utilisation

```bash
python main.py
```

L'agent traitera la liste de prospects définie dans `main.py` et affichera un message de prospection personnalisé pour chacun d'eux.

---

## Structure du projet

```
.
├── agent/
│   ├── __init__.py
│   ├── config.py               # Chargement de la configuration
│   └── prospection_agent.py    # Logique principale de l'agent
├── main.py                     # Point d'entrée
├── requirements.txt
├── .env.example                # Modèle de fichier de configuration
└── README.md
```

---

## Configuration

| Variable         | Valeur par défaut | Description                                      |
|------------------|-------------------|--------------------------------------------------|
| `OPENAI_API_KEY` | *(obligatoire)*   | Clé API OpenAI                                   |
| `OPENAI_MODEL`   | `gpt-4o`          | Modèle OpenAI à utiliser                         |
| `MAX_PROSPECTS`  | `10`              | Nombre maximum de prospects par session          |
| `LANGUAGE`       | `fr`              | Langue des messages générés (`fr`, `en`, etc.)   |

---

## Licence

MIT
