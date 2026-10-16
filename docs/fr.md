# WeatherFlow Tempest

Cette intégration amène votre station météo **WeatherFlow Tempest** dans
Gladys : température, humidité, pression, vent, luminosité, UV, pluie et
foudre, mises à jour chaque minute, avec des déclencheurs de scène (la pluie
commence, foudre, station injoignable), des actions de scène (lire la station,
lire les prévisions) et un widget pour le tableau de bord.

Elle fonctionne **sur votre réseau local**, sans compte ni Internet, et/ou
**via le cloud Tempest** avec un jeton d'accès personnel.

## Prérequis

- Gladys **5.1 ou plus récent**.
- Une station Tempest et son hub, installés avec l'application Tempest.
- Pour le réseau local : le hub et Gladys sur le **même réseau** (même
  sous-réseau, pas de VLAN ni de Wi-Fi invité entre les deux). Le hub diffuse
  ses données en UDP sur le port **50222**.
- Pour le cloud (facultatif) : un jeton d'accès personnel.

## Configuration

1. Installez l'intégration, puis ouvrez son onglet **Configuration**.
2. Facultatif — **cloud** : sur [tempestwx.com](https://tempestwx.com/settings/tokens)
   (Settings → Data Authorizations → Create Token), créez un jeton d'accès
   personnel et collez-le dans **Jeton d'accès personnel**. Il apporte le nom
   de vos stations, leur altitude et leur fuseau horaire, les prévisions, et
   prend le relais quand le hub n'est pas entendu sur le réseau local.
3. Choisissez les unités de **température** et de **vent**. La distance de la
   foudre suit l'unité du vent (miles avec mph, kilomètres sinon). La pluie
   reste en millimètres et la pression en hectopascals : Gladys n'a pas
   d'unité impériale pour elles.
4. Facultatif — **altitude de la station** (mètres) : nécessaire pour la
   pression au niveau de la mer quand vous n'avez pas de jeton. Avec un jeton,
   laissez vide : l'altitude réglée dans l'application Tempest est utilisée.
5. Facultatif — **fuseau horaire** (ex. `Europe/Paris`) : l'heure à laquelle
   le compteur « pluie du jour » repart de zéro. Vide : le fuseau de la station
   (jeton), sinon UTC.
6. Enregistrez, ouvrez l'onglet **Découverte** et ajoutez votre station. Une
   station entendue sur le réseau local apparaît en moins d'une minute.

### Réseau local ou cloud

Gladys affiche un interrupteur **Préférer la connexion locale** :

- **Activé** (par défaut) : l'intégration écoute le hub sur le réseau local.
  Si rien n'est reçu pendant deux minutes et qu'un jeton est saisi, le cloud
  prend le relais, et le réseau local reprend la main dès que le hub est de
  nouveau entendu.
- **Désactivé** : le cloud est utilisé, le réseau local seulement quand le
  cloud ne répond pas.
- Sans jeton, seul le réseau local est utilisé.

Chaque station affiche un **badge** avec le canal utilisé : local, cloud ou
injoignable. Un point orange signifie « ça marche, mais pas par le canal que
vous préférez » ; son info-bulle dit pourquoi.

Chaque mesure n'est traitée qu'une fois, quel que soit le canal qui l'apporte
en premier : rien n'est compté deux fois quand les deux canaux tournent.

## Ce que vous obtenez

Un appareil Gladys par Tempest, avec ces fonctionnalités :

| Fonctionnalité               | Unité            | Remarques                                      |
| ---------------------------- | ---------------- | ---------------------------------------------- |
| Température                  | °C ou °F         |                                                |
| Humidité                     | %                |                                                |
| Pression de la station       | hPa              | mesurée à la station                           |
| Pression au niveau de la mer | hPa              | demande l'altitude (jeton ou configuration)    |
| Vitesse du vent, Rafale      | km/h, m/s ou mph | moyenne sur 1 minute et rafale                 |
| Direction du vent            | °                |                                                |
| Luminosité                   | lux              |                                                |
| Indice UV                    | -                |                                                |
| Pluie (dernière heure)       | mm/h             | pluie des 60 dernières minutes                 |
| Pluie (aujourd'hui)          | mm/jour          | depuis minuit                                  |
| Il pleut                     | oui/non          | s'arrête après 10 minutes sans pluie           |
| Éclairs (dernière heure)     | -                |                                                |
| Distance du dernier éclair   | km ou mi         |                                                |
| Batterie                     | %                | estimée à partir de la tension (2,35 à 2,80 V) |

Les noms des fonctionnalités sont en anglais dans Gladys ; vous pouvez les
renommer. Chaque valeur peut servir dans les scènes Gladys habituelles
(déclencheur « état d'un appareil », conditions) et dans les graphiques.

## Actions

- **Tester la connexion** — écoute le réseau local pendant 15 secondes et
  interroge le cloud avec votre jeton, puis affiche ce qu'elle a trouvé sous le
  bouton.

## Scènes

L'intégration ajoute ses propres cartes dans l'éditeur de scènes, dans la
catégorie **Intégrations**.

Déclencheurs :

- **La pluie commence** — les premières gouttes après au moins dix minutes
  sans pluie. Variable : `{{triggerEvent.data.rain_today}}` (mm).
- **Foudre détectée** — un éclair à moins de 40 km, au plus un événement par
  minute et par station (un orage en envoie des dizaines). Variables :
  `{{triggerEvent.data.distance}}` (km ou miles),
  `{{triggerEvent.data.energy}}`, `{{triggerEvent.data.strikes_last_hour}}`.
- **Station injoignable** — plus rien reçu de la station depuis dix minutes,
  sur aucun canal.

Pour chaque déclencheur, vous pouvez choisir la station ; laissé vide, toutes
les stations conviennent.

Actions :

- **Lire la station** — donne les valeurs actuelles aux actions suivantes :
  température, ressenti, point de rosée, humidité, pression, vitesse, rafale et
  direction du vent (en degrés et en N, NE, E...), UV, luminosité, pluie de la
  dernière heure et du jour, pluie en cours, éclairs de la dernière heure,
  distance du dernier éclair et âge de la mesure en minutes. `available` vaut
  faux tant qu'aucune mesure n'a été reçue.
- **Lire les prévisions** — les prévisions Tempest pour aujourd'hui, demain ou
  après-demain : conditions (texte anglais de Tempest), code d'icône,
  températures maximale et minimale, probabilité et type de précipitations,
  lever et coucher du soleil. Demande le jeton.

Exemple : « Chaque matin à 7 h → Lire les prévisions (aujourd'hui) → m'envoyer
`Aujourd'hui : {{conditions}}, de {{temperature_low}} à {{temperature_high}}°` ».

## Tableau de bord

Ajoutez le widget **Station Tempest** à un tableau de bord. Il affiche des
tuiles en direct (température, humidité, vent, pluie du jour, UV), la
température des dernières 24 heures, et une liste avec le ressenti, le point
de rosée, la pression, la direction du vent et les rafales, le dernier éclair,
la pluie, la batterie, la connexion utilisée et l'âge de la dernière mesure.
Avec un jeton, un bouton **Actualiser** récupère la dernière mesure depuis le
cloud.

Si vous avez plusieurs stations, choisissez-en une dans les réglages du widget.

## Dépannage

- **Aucune station dans Découverte, pas de jeton** : le hub et Gladys doivent
  partager le réseau. Vérifiez que le port UDP 50222 n'est pas filtré, que le
  hub n'est pas sur un Wi-Fi invité ou un autre VLAN, et que l'application
  Tempest affiche la station en ligne. Utilisez **Tester la connexion**.
- **« Le cloud Tempest refuse le jeton »** : le jeton a été révoqué ou mal
  copié ; créez-en un nouveau.
- **Pression au niveau de la mer vide** : saisissez l'altitude de la station,
  ou ajoutez un jeton.
- **« Pluie du jour » remise à zéro à la mauvaise heure** : saisissez le
  fuseau horaire.
- **Le badge affiche le cloud avec un point orange** : le hub n'est pas
  entendu sur le réseau local ; les données continuent d'arriver par le cloud.

Consultez les logs de l'intégration depuis l'interface de Gladys pour le
détail.

## Vie privée

Sur le réseau local, aucune donnée ne sort de chez vous. Le jeton est stocké
dans Gladys comme un secret, envoyé seulement aux serveurs Tempest, et jamais
écrit dans les logs.
