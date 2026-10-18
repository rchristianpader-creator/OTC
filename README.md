# OTC Sachkunde

Lern-App für die IHK-Sachkundeprüfung „freiverkäufliche Arzneimittel“: Karteikasten nach dem
Leitner-System, Prüfungsfragen zum Antippen, Drogen-Probe und Generalprobe (50 Fragen + 15 Drogen).

**Web-App:** https://rchristianpader-creator.github.io/OTC/ (Zweig `gh-pages`, passwortgeschützt)

## Inhalt dieses Zweigs

| Datei | Zweck |
|---|---|
| `src/otc-sachkunde.html` | Quelltext der App (läuft als Claude-Artefakt und als Web-App) |
| `tools/build_web.mjs` | baut `index.html` für GitHub Pages; Karten und Fotos werden mit AES-256-GCM verschlüsselt |
| `tools/moodle_sync.py` | überträgt in der App beantwortete Prüfungsfragen in die Moodle-Tests A–F |

Kursinhalte (Fragen, Texte, Drogenfotos) und Passwörter liegen bewusst **nicht** in diesem Repository.

## Moodle-Übertragung

In der App unter „IHK-Sachkundeprüfung“ auf **„Stand für Moodle kopieren“** tippen. Der Text sieht so aus:

```
OTC-MOODLE 1 · 2026-10-18
A: 13+ 78- 92+
B: 23-
```

`+` = richtig beantwortet, `-` = falsch. Das Skript kreuzt in Moodle genau diese Fragen an (richtig bzw. eine
falsche Antwort), lässt den Rest leer und gibt den Versuch ab. Zugangsdaten kommen aus `MOODLE_USER` und
`MOODLE_PASSWORD`; mit `--offline <ordner>` wird nur geprüft, nichts gesendet.
