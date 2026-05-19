# EcoSphere Dashboard - Terratech Solutions

EcoSphere Dashboard est une plateforme SaaS collaborative de suivi en temps réel de l'empreinte carbone et de l'impact environnemental des infrastructures cloud d'entreprise.

---

## 🍃 Approche Éco-conception (Green IT)

Ce projet a été développé en suivant scrupuleusement les recommandations du RGESN (Référentiel Général d'Éco-conception de Services Numériques) :

### 🖥️ Compatibilité Matérielle & Système (Spec1, Spec2, Spec3)
* **Matériels cibles** : Optimisé pour fonctionner sur des terminaux d'entrée de gamme (smartphones à partir de 2 Go de RAM, processeurs quadri-coeurs).
* **Rétrocompatibilité** : L'interface est compatible avec les anciens terminaux mobiles et supporte les versions d'OS depuis **iOS 12+** et **Android 8+**.
* **Navigateurs supportés** : Prise en charge de Chrome 70+, Firefox 65+, Safari 11+ et Edge 18+.

### 🎨 Design Adaptatif & Ergonomie (Spec4, Uxui1, Uxui2)
* **Responsive Design** : Grille entièrement adaptative s'ajustant sans perte d'information de 320px de large jusqu'aux écrans 4K.
* **Médias** : Aucun média (vidéo, audio) ne se lance automatiquement. L'activation des flux vidéo ou audio est strictement soumise au consentement de l'utilisateur via un bouton "Play".
* **Navigation Frugale** : Pas de défilement infini (infinite scroll) ; utilisation d'une pagination classique claire pour limiter le chargement de données superflues.

### 🌐 Hébergement Éco-responsable (Heb1)
L'application EcoSphere est hébergée sur des serveurs situés en France (GreenData Paris), un centre de données alimenté à **100% par des énergies renouvelables** avec un PUE (Power Usage Effectiveness) garanti inférieur à 1.15 et utilisant un système de refroidissement passif (free cooling).

### ♿ Accessibilité Numérique (Acc3)
Un audit d'accessibilité RGAA a été mené en mars 2026, attestant d'un **taux de conformité globale de 88%**, garantissant une navigation aisée pour les utilisateurs naviguant au clavier ou via des lecteurs d'écran (synthèse vocale).

---

## 🛠️ Installation & Démarrage

```bash
# Installer les dépendances (légères)
npm install

# Lancer en mode de développement
npm run dev

# Compiler pour la production
npm run build
```
