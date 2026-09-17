// Première version : paragraphes séparés par des lignes vides.
export const FIRST = `---
titre: Le retour
tags: [roman]
---
# Chapitre 3

Le train arriva en gare de Saint-Aubin un peu avant midi. Clara descendit la première, sa valise à la main, et chercha des yeux la silhouette de son frère parmi les voyageurs qui se pressaient sur le quai.

Il n'était pas là. Elle attendit dix minutes, puis vingt, en regardant l'horloge au-dessus du guichet dont les aiguilles semblaient avancer plus lentement que partout ailleurs.

— Tu es sûre qu'il t'a dit midi ? demanda le chef de gare.
— Oui.
— Alors il viendra.

Elle sortit sur la place. Les platanes avaient été taillés depuis sa dernière visite et le café des Sports avait changé de nom : il s'appelait maintenant « Le Relais », en lettres dorées sur fond vert.

Elle s'assit en terrasse et commanda un café. Le serveur, un garçon maigre aux cheveux trop longs, lui apporta sa tasse sans un mot et repartit aussitôt vers le comptoir.

— Vous attendez quelqu'un ?
— Oui.

La voiture de Paul apparut enfin au bout de l'avenue, une vieille Renault bleue dont le pot d'échappement pétaradait à chaque changement de vitesse. Il se gara n'importe comment devant la fontaine et sortit en agitant les bras.

Ils s'embrassèrent maladroitement. Paul sentait le tabac et l'huile de moteur ; il avait maigri, et une barbe de plusieurs jours lui mangeait les joues.

Sur la route du moulin, ils parlèrent peu. Clara regardait défiler les champs de tournesols, les haies de noisetiers, les panneaux rouillés qui indiquaient des hameaux dont elle avait oublié jusqu'à l'existence.

La maison n'avait pas changé. Le crépi s'effritait toujours au coin du pignon, et la glycine, que personne ne taillait plus, avait fini par recouvrir entièrement la fenêtre de la cuisine.

— Maman t'attend, dit Paul en coupant le moteur.
— Oui.

Clara resta un moment assise dans la voiture, les mains posées sur ses genoux, à regarder la porte d'entrée comme si elle allait s'ouvrir d'elle-même.`;

// Version relue : sans lignes vides, un paragraphe coupé en deux, deux fusionnés, un supprimé
// (« La maison… »), un ajouté (« Au dernier virage… ») et des corrections un peu partout.
export const PROOFREAD = `---
titre: Le retour
tags: [roman]
relu: oui
---
# Chapitre 3
Le train arriva en gare de Saint-Aubin peu avant midi. Clara descendit la première, sa valise à la main, et chercha du regard la silhouette de son frère parmi les voyageurs qui se pressaient sur le quai.
Il n'était pas là.
Elle attendit dix minutes, puis vingt, en regardant l'horloge au-dessus du guichet, dont les aiguilles semblaient avancer plus lentement que partout ailleurs.
— Vous êtes sûre qu'il vous a dit midi ? demanda le chef de gare.
— Oui.
— Alors, il viendra.
Elle sortit sur la place. Les platanes avaient été taillés depuis sa dernière visite, et le café des Sports avait changé de nom : il s'appelait désormais « Le Relais », en lettres dorées sur fond vert.
Elle s'assit en terrasse et commanda un café. Le serveur, un garçon maigre aux cheveux trop longs, lui apporta sa tasse sans un mot et repartit aussitôt vers le comptoir.
— Vous attendez quelqu'un ?
— Oui.
La voiture de Paul apparut enfin au bout de l'avenue, une vieille Renault bleue dont le pot d'échappement pétaradait à chaque changement de vitesse. Il se gara de travers devant la fontaine et sortit en agitant les bras.
Ils s'embrassèrent maladroitement. Paul sentait le tabac et l'huile de moteur ; il avait maigri, et une barbe de plusieurs jours lui mangeait les joues. Sur la route du moulin, ils parlèrent peu. Clara regardait défiler les champs de tournesols, les haies de noisetiers, les panneaux rouillés qui indiquaient des hameaux dont elle avait oublié jusqu'à l'existence.
Au dernier virage, le clocher de l'église apparut entre deux collines, plus petit que dans son souvenir.
— Maman t'attend, dit Paul en coupant le moteur.
— Oui.
Clara resta un long moment assise dans la voiture, les mains posées sur les genoux, à regarder la porte d'entrée comme si elle allait s'ouvrir d'elle-même.`;

export const UNRELATED = `Préchauffer le four à 180 degrés.
Mélanger la farine, le sucre et les œufs dans un grand saladier.
Ajouter le beurre fondu puis verser la pâte dans un moule beurré.
Enfourner pendant quarante minutes et laisser refroidir avant de démouler.`;

// Prose française sans rapport, de même registre : plus difficile à écarter qu'une recette.
export const OTHER_PROSE = `La réunion du lundi commença avec vingt minutes de retard, parce que le projecteur refusait de reconnaître l'ordinateur portable du directeur financier.
Martine distribua les dossiers imprimés en s'excusant pour les fautes de frappe, que personne ne remarqua de toute façon.
On passa rapidement sur les chiffres du trimestre, jugés décevants mais conformes aux prévisions révisées en mars.
— Des questions ? demanda le directeur.
— Non.
Le débat s'anima lorsqu'il fut question du déménagement des bureaux vers la zone industrielle, à quinze kilomètres du centre-ville.
Plusieurs employés firent valoir qu'aucune ligne de bus ne desservait le nouveau site avant huit heures du matin.
La séance fut levée sans décision, et chacun retourna à son poste en maugréant contre la direction.`;
