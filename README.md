# Portail d'Évaluation RGESN (Référentiel Général d'Écoconception de Services Numériques)

Ce portail est une application web d'ingénierie Green IT conçue pour auditer l'empreinte environnementale logicielle d'un service numérique. Elle permet d'ingérer l'archive de code source d'un projet, d'analyser automatiquement ses patterns techniques par rapport aux critères RGESN, de calculer un score global de conformité pondéré et de compléter manuellement les critères de gouvernance (Hébergement, Accessibilité).

---

## 🚀 Fonctionnalités Clés

1. **Ingestion Frugale et File Asynchrone** : Téléversement par glisser-déposer de fichiers de projet au format `.zip`. Les projets sont traités séquentiellement dans une file d'attente asynchrone en arrière-plan pour éviter les pics de CPU (Green IT). Les fichiers temporaires sont supprimés dès la fin du scan.
2. **Analyseur Statique (Rule Engine)** : Détection automatique de patterns techniques via des regex et heuristiques dans le code source (dépendances standard vs propriétaires, attributs `autoplay`, écouteurs de scroll infini, budgets de performance, Service Workers, stratégies CI/CD, scripts de Machine Learning).
3. **Calcul de Score Dynamique** : Calcule le pourcentage global de conformité selon la pondération officielle ($Priorité \times Difficulté$). Les critères non applicables (N/A) détectés automatiquement (comme les critères vidéo sur un projet sans vidéo ou d'IA sur un projet sans ML) sont **exclus du numérateur et du dénominateur** pour ne pas fausser le score.
4. **Console d'Auto-Déclaration** : Une interface moderne (Slate / Glassmorphism) permettant de filtrer les critères, d'inspecter les traces techniques repérées par l'analyseur (findings), d'accéder d'un clic aux fiches de référence du guide **GR491**, et de déclarer manuellement la conformité pour les critères hors-code (Accessibilité, Hébergement).

---

## 🛠️ Prérequis

Avant de lancer l'application, assurez-vous d'avoir installé :
* [Node.js](https://nodejs.org/) (Version **18.x** ou supérieure requise - testé avec succès en **v24.14.1**).
* Un navigateur web moderne (Chrome, Firefox, Edge, Safari).

---

## 📦 Installation et Lancement

Suivez ces étapes simples pour démarrer l'application localement :

### Étape 1 : Cloner ou ouvrir le dossier du projet
Assurez-vous d'être positionné à la racine du projet `rgesn_scoring` dans votre terminal.

### Étape 2 : Installer les dépendances
Installez les bibliothèques requises (Express 5, Multer, Adm-Zip, SheetJS `xlsx`, UUID) :
```bash
npm install
```

### Étape 3 : Lancer le serveur d'application
Démarrez le serveur web local :
```bash
npm start
```

Le terminal affichera alors la confirmation de démarrage :
```text
===================================================
 RGESN Scoring Application Server is running!
 Web interface: http://localhost:3000
 Environment:   Production / GreenIT optimized
===================================================
```

### Étape 4 : Ouvrir l'interface web
Ouvrez votre navigateur et naviguez vers l'adresse suivante :
👉 **[http://localhost:3000](http://localhost:3000)**

---

## 🤖 Configuration de l'Analyse par IA (Optionnel)

L'application intègre un mode d'analyse sémantique assistée par Intelligence Artificielle. Vous pouvez utiliser un modèle d'IA gratuit s'exécutant **localement en toute confidentialité** grâce à **Ollama**, ou renseigner une clé API d'un service cloud (OpenAI, Mistral, Anthropic).

### Audit Local avec Ollama (Recommandé)

Pour faire fonctionner l'audit par IA gratuitement et sans envoyer de données sur le cloud :

#### 1. Installer Ollama
* **Windows & macOS** : Téléchargez et lancez l'installateur depuis le site officiel : 👉 **[https://ollama.com/](https://ollama.com/)**
* **Linux** : Lancez la commande suivante dans votre terminal :
  ```bash
  curl -fsSL https://ollama.com/install.sh | sh
  ```

#### 2. Télécharger un modèle
Une fois Ollama installé et en cours d'exécution en arrière-plan, ouvrez un terminal et téléchargez le modèle par défaut (`qwen3:0.6b`) :
```bash
ollama pull qwen3:0.6b
```
*(Vous pouvez également installer d'autres modèles très légers et frugaux comme `gemma:2b` ou `qwen2.5:0.5b` pour les ordinateurs moins puissants)*

#### 3. Vérifier le fonctionnement d'Ollama
Ouvrez votre navigateur sur **[http://localhost:11434](http://localhost:11434)**. Si la connexion fonctionne, la page doit afficher :
```text
Ollama is running
```

#### 4. Lancer l'analyse dans l'interface
* Sélectionnez l'onglet **Assistée par IA** dans la section *Mode d'analyse*.
* Laissez le fournisseur sur **Local (Ollama)**.
* Spécifiez le nom du modèle téléchargé (par défaut `qwen3:0.6b`).
* Glissez votre archive ZIP et cliquez sur **Lancer l'Analyse**.

> [!NOTE]
> **Robustesse intégrée (Graceful Fallback)** : Si le service Ollama local n'est pas démarré ou rencontre un problème, l'analyseur bascule **automatiquement et de manière invisible** en mode *Classique (Regex)* pour calculer votre score, et affiche le détail de l'erreur réseau dans le panneau de diagnostic en haut de page.

---

## 📖 Guide d'Utilisation pas-à-pas

### 1. Préparer le fichier de votre projet
Compressez le dossier contenant le code source de votre application web ou service numérique au format **ZIP** (ex: `mon-projet.zip`).
> [!TIP]
> Il n'est pas nécessaire d'inclure les dossiers lourds comme `node_modules` ou `.git` dans votre archive ; le scanner les ignore automatiquement pour rester frugal et rapide.

### 2. Téléverser le projet
* Sur la page d'accueil de l'interface, donnez un nom à votre évaluation dans le champ **Nom du Projet**.
* Glissez-déposez votre archive ZIP dans la zone en pointillés ou cliquez sur **Parcourir** pour la sélectionner.
* Cliquez sur **Lancer l'Analyse**.

### 3. Consulter les résultats
* **Score de conformité global** : Affiché au centre via un anneau de progression coloré et dynamique.
* **Barre d'impact par catégorie** : Un résumé visuel pour chacune des 10 dimensions RGESN pour identifier instantanément les catégories en retard.
* **Section Quick Wins** : L'interface isole les critères non conformes classés comme **Prioritaires** avec une **Difficulté Faible** (ex: absence d'autoplay, pas de scroll infini). Ce sont les optimisations offrant le meilleur ratio effort/réduction d'impact.

### 4. Réaliser les auto-déclarations (Manuel)
* Dans le tableau des résultats en bas de page, filtrez par **Auto-Déclaration** ou recherchez un code spécifique (ex: `Acc1`).
* Cliquez sur une ligne de critère pour la déplier. Vous y trouverez l'objectif du référentiel, la justification de l'état actuel et un bouton d'accès direct vers le guide **GR491**.
* Utilisez le sélecteur à droite (**Conforme (Validé)**, **Non-Conforme**, **Non Applicable**) pour déclarer l'état réel du critère. Le score global et les graphiques se mettent à jour instantanément sans recharger la page.

---

## 📂 Structure du Projet

* `server.js` : Point d'entrée de l'application Express, configurant les routes d'API sécurisées et le serveur de fichiers statiques.
* `analyzer.js` : Moteur de règles (Rule Engine) analysant statiquement les fichiers par expressions régulières pour corréler le code aux critères RGESN.
* `queue.js` : Gestionnaire de file d'attente séquentielle pour un traitement asynchrone respectueux du processeur.
* `db.js` : Gestionnaire de persistance locale de l'historique (`db_store.json`) et implémentation de l'algorithme de calcul de score.
* `rgesn_criteria.json` : Référentiel complet des critères importés de la feuille Excel.
* `calcul_score.md` : Documentation mathématique du barème de calcul.
* `public/` : Dossier contenant le code client SPA (HTML, CSS premium à tokens de conception HSL et Javascript réactif).
