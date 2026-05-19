# Algorithme de Calcul du Score de Conformité RGESN

L'évaluation de la performance environnementale d'un service numérique repose sur une pondération qui valorise les critères à fort impact (prioritaires) tout en prenant en compte la complexité technique de mise en œuvre (difficulté).

---

## 1. Pondération des Critères

Chaque critère du référentiel se voit attribuer deux coefficients : la **Priorité** et la **Difficulté**.

### Priorité (Importance environnementale)
- **Prioritaire** : Coefficient = `3`
- **Recommandé** : Coefficient = `1`

### Difficulté (Complexité technique de mise en œuvre)
- **Faible** : Coefficient = `1`
- **Moyen** : Coefficient = `2`
- **Fort** : Coefficient = `3`

---

## 2. Calcul du Score par Critère

Pour chaque critère évalué, trois états sont possibles :
1. **Validé (Conforme)** : Le critère est respecté.
2. **Non-Validé (Non-conforme)** : Le critère n'est pas respecté.
3. **Non-Applicable (N/A)** : Le critère ne s'applique pas au projet analysé (par exemple, des critères liés aux vidéos sur un projet sans aucun contenu vidéo).

### Formule de Points par Critère :
- **Si Validé** : `Points Obtenus = Valeur Priorité × Valeur Difficulté`
- **Si Non-Validé** : `Points Obtenus = 0`
- **Si Non-Applicable** : Le critère est exclu du calcul global.

#### Points Maximum par Critère :
`Points Max = Valeur Priorité × Valeur Difficulté`

---

## 3. Calcul du Score Global (%)

Le score global de conformité environnementale est le ratio des points obtenus sur la somme des points maximum possibles des critères applicables.

$$Score\ Global\ (%) = \left( \frac{\sum Points\ Obtenus}{\sum Points\ Max\ des\ Critères\ Applicables} \right) \times 100$$

> [!IMPORTANT]
> La somme des points maximum possibles **exclut totalement** les critères identifiés comme **Non-Applicables (N/A)** lors du scan automatique ou de la déclaration manuelle. Cela évite de pénaliser injustement un projet (ex: pas de vidéo = critères Cont1 à Cont3 exclus).

---

## 4. Exemple de Calcul Réel

Considérons un audit simplifié sur 4 critères :

| Critère | Priorité | Difficulté | État | Points Obtenus | Points Max (Si applicable) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Uxui1** | Prioritaire (3) | Faible (1) | **Validé** | 3 (3 x 1) | 3 |
| **Uxui2** | Prioritaire (3) | Moyen (2) | **Non-Validé** | 0 | 6 |
| **Cont3** | Prioritaire (3) | Fort (3) | **Non-Applicable**| *Exclu* | *Exclu* |
| **Bck2** | Recommandé (1) | Moyen (2) | **Validé** | 2 (1 x 2) | 2 |

**Calculs intermédiaires :**
- Total Points Obtenus = 3 (Uxui1) + 0 (Uxui2) + 2 (Bck2) = 5 points
- Total Points Max Applicables = 3 (Uxui1) + 6 (Uxui2) + 2 (Bck2) = 11 points

**Calcul du Score Global :**
$$Score\ Global = \left( \frac{5}{11} \right) \times 100 \approx 45.45\%$$
