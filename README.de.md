[![CI](https://github.com/zidell/ginote/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/zidell/ginote/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/zidell/ginote/branch/main/graph/badge.svg)](https://codecov.io/gh/zidell/ginote)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README.md) | [한국어](README.ko.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | **Deutsch** | [Français](README.fr.md) | [Italiano](README.it.md) | [Español](README.es.md)

# Ginote

## Über die App

Ginote ist eine einfache, sichere Web-App, mit der du GitHub Issues wie persönliche
Notizen nutzen kannst. Ich mag GitHub Issues, aber die Trägheit und die umständliche UX
haben mich schon immer gestört. Deshalb habe ich eine SPA gebaut, die den
Funktionsumfang nahezu unverändert übernimmt und nur das Nutzungserlebnis einer
Notiz-App bietet. Die App besteht ausschließlich aus statischem JS, und der Browser
kommuniziert direkt mit der GitHub API – deshalb ist sie sicher.

Live-App (für alle frei nutzbar): [https://note.gitools.net](https://note.gitools.net)

## Vorschau

![Ginote-Vorschau](docs/preview.gif)

Wie das Vorschau-GIF neu erstellt wird, steht in [docs/screencasting.md](docs/screencasting.md).

## Funktionen

- **Direkt in einem privaten Repository gespeichert:** Issues in einem privaten
  Repository dienen als Notizen – ganz ohne eigenen App-Server oder Datenbank.
- **Direkte Verbindung aus dem Browser:** Der Browser ruft die GitHub API direkt auf. Es
  gibt keinen Zwischenschritt, bei dem ein Server des App-Betreibers Notizen oder PAT
  entgegennimmt oder speichert.
- **Tags, Suche und Papierkorb:** GitHub-Labels werden als Tags verwendet (jedes Tag kann
  eine Beschreibung erhalten); dazu gibt es eine Volltextsuche und einen Papierkorb auf
  Basis geschlossener Issues. Häufig genutzte Notizen lassen sich oben anheften.
- **Kommentare:** Issue-Kommentare dienen als fortlaufende Einträge zu einer Notiz. Auch
  an Kommentare lassen sich Dateien anhängen, und sie können per Sprache erfasst werden.
- **Datei- und Bildanhänge:** Anhänge von Notizen und Kommentaren werden im selben
  Repository gespeichert und sind sowohl in der App als auch auf GitHub einsehbar.
  Details unter [Speicherung von Anhängen](docs/ATTACHMENTS.md).
- **Sprachaufnahme, Transkription und Aufbereitung (nur OpenAI):** Im Browser
  aufgenommene Sprache wird direkt bei OpenAI transkribiert, und das Transkript kann zu
  natürlichem Fließtext aufbereitet werden. Dabei lassen sich auch ein Titel erzeugen und
  vorhandene Tags vorschlagen; bei Bedarf wird die Originalaufnahme als Notizanhang
  aufbewahrt. Die Sprachfunktionen unterstützen derzeit nur die OpenAI API.
- **Notizsperre (zusätzliche Verschlüsselung):** Reicht ein privates Repository allein
  nicht aus, kannst du eine Notiz mit einem 6-stelligen Code sperren; Inhalt und
  Kommentare werden dann im Browser zusätzlich mit AES-GCM verschlüsselt. Details unter
  [Verschlüsselung](docs/ENCRYPTION.md).
- **Bearbeitungswerkzeuge:** Mehrere Notizen zu einer zusammenführen, im Inhalt suchen
  und ersetzen (mit Unterstützung für reguläre Ausdrücke) und das gerenderte Ergebnis im
  Markdown-Viewer ansehen.
- **Mehrere Repositories:** Mehrere Repositories registrieren und über die Liste oder die
  Zifferntasten direkt wechseln.
- **Tastatursteuerung:** Notizliste durchblättern, Notizen öffnen und auswählen, neue
  Notizen anlegen, Repositories wechseln – alles per Tastatur.
- **MCP-Integration:** Mit dem offiziellen GitHub MCP Server können auch KI-Tools
  dieselben Notizen (Issues) lesen und schreiben. Ein eigener MCP-Server für die App ist
  nicht nötig.
- **Web und Desktop:** Verfügbar als installierbare PWA sowie als Tauri-basierte App für
  macOS, Windows und Linux. Zu Paketierung und Releases der Desktop-App siehe die
  [Desktop-Dokumentation](docs/DESKTOP.md).

## Nutzung

### Wohin gehen meine Daten?

**Ginote ist eine statische Web-App, die als Dateien ausgeliefert wird.** Der
Hosting-Server liefert nur App-Dateien wie HTML, CSS und JavaScript aus. Es gibt kein
App-Backend für Anmeldung oder Notizspeicherung; nach dem Öffnen der App läuft der
gesamte Datenverkehr direkt zwischen deinem Browser und der GitHub API.

```text
Dein Browser  ←──── direkte Verbindung ────→  GitHub
     │
     └─ PAT, App-Einstellungen und ungespeicherte Entwürfe bleiben nur in diesem Browser
```

- Notizen, Tags und Anhänge werden ausschließlich in dem von dir angegebenen
  GitHub-Repository gespeichert.
- PAT und App-Einstellungen werden nur in deinem Browser gespeichert und nur zur
  Authentifizierung an die GitHub API gesendet.
- Ungespeicherte Entwürfe verbleiben nur in diesem Browser.
- Die optionale Notizverschlüsselung ist unter [Verschlüsselung](docs/ENCRYPTION.md)
  beschrieben.
- Es gibt keine API, die Notizen, PAT oder Einstellungen an den App-Betreiber sendet,
  und es werden keine Analyse- oder Tracking-Dienste verwendet.

Kurz gesagt: Abgesehen von den Anfragen zum Herunterladen der App-Dateien werden keine
deiner Daten an den App-Betreiber oder an andere Server außer GitHub übertragen. Deine
Notizdaten existieren tatsächlich **nur in deinem eigenen Browser und in dem
GitHub-Repository, das du ausgewählt hast**.

### Sprachaufnahme verwenden

Bevor du die Sprachaufnahme zum ersten Mal nutzt, brauchst du einen OpenAI-API-Schlüssel.
Erstelle einen API-Schlüssel bei OpenAI und trage ihn in Ginote unter
**Einstellungen → Sprachaufnahme → OpenAI-API-Schlüssel** ein. Je nach API-Nutzung können
bei OpenAI Kosten anfallen.

Danach startest du eine Aufnahme über die Mikrofon-Schaltfläche in der Seitenleiste oder
in der Notizansicht. Nach Ende der Aufnahme wird die Sprache transkribiert; anschließend
werden das optionale Aufbereitungsmodell und die Aufbereitungsregeln angewendet, um
Inhalt, Titel und vorhandene Tags vorzuschlagen. In den Einstellungen kannst du das
Transkriptionsmodell, das Aufbereitungsmodell und häufig verwendete Begriffe für die
Transkription ändern; bleibt das Aufbereitungsmodell leer, wird nur das Transkript
gespeichert. Mit **Originalaufnahme behalten** wird bei erfolgreichen Aufnahmen auch die
Originalaufnahme als Anhang der Notiz gespeichert.

Audiodateien und Transkripte werden direkt vom Browser an die OpenAI API gesendet und
laufen nicht über einen App-Server. Der API-Schlüssel wird im Klartext im
`localStorage` des Browsers auf diesem Gerät gespeichert. Verwende ihn daher nur auf
persönlichen Geräten; empfohlen werden ein eigener Projektschlüssel, Nutzungslimits und
regelmäßiger Austausch.

### Tastenkürzel

In der Notizliste stehen die folgenden Tastenkürzel zur Verfügung. Während du in einem
Eingabefeld tippst, sind die Listen-Tastenkürzel deaktiviert. `Ctrl/Cmd + R` ist das
Neuladen-Kürzel des Browsers und lädt die App überall neu.

| Taste | Aktion |
| --- | --- |
| `↑` / `↓` | In der Notizliste bewegen |
| `Enter` | Aktuelle Notiz öffnen · erneut drücken zum Bearbeiten |
| `N` | Neue Notiz erstellen |
| `` ` `` | Repository-Auswahl öffnen |
| `1`–`9` | Repository in der Reihenfolge der Registrierung wechseln |
| `Esc` | Auswahl aufheben · Löschen abbrechen · Hinweis schließen |
| `Space` | Aktuelle Notiz auswählen |
| `Shift` + `↑` / `↓` | Mehrere Notizen als Bereich auswählen |
| `Delete` / `Backspace` | Ausgewählte Notizen in den Papierkorb verschieben |
| `Ctrl/Cmd + R` | App neu laden |

Wenn eine Notiz geöffnet ist und kein Eingabefeld den Fokus hat, sind zusätzlich diese
Tastenkürzel verfügbar.

| Taste | Aktion |
| --- | --- |
| `T` | Tag hinzufügen |
| `A` | Datei anhängen |
| `P` | Oben anheften umschalten |
| `L` | Sperren · entsperren |
| `Delete` | Notiz in den Papierkorb verschieben |
| `G` | GitHub-Issue anzeigen |
| `M` | MD-Viewer öffnen · schließen |
| `R` | Gesamte App neu laden |
| `S` | Aktuelle Notiz speichern |

### PWA (installierbare Web-App)

Produktions-Builds laufen als PWA, die du im Browser installieren und wie eine App nutzen
kannst. Öffne die Live-App im Browser und verwende das Installationsmenü des Browsers.
Manifest und Service Worker sind an keine bestimmte Domain oder keinen Hosting-Dienst
gebunden und arbeiten relativ zu dem Pfad, unter dem die App bereitgestellt wird. Der
Service Worker (eine Funktion, mit der der Browser App-Dateien vorübergehend vorhält)
cached nur Dateien aus demselben Ursprung wie die App – niemals GitHub-API-Anfragen, PAT
oder Notizdaten.

### Desktop-App herunterladen

Installationsdateien für macOS, Windows und Linux gibt es unter
[GitHub Releases](https://github.com/zidell/ginote/releases). macOS verwendet ein DMG,
Windows 10/11 ein MSI. Neue Windows-Releases werden als signierte MSI veröffentlicht,
sobald die Signierung über die SignPath Foundation eingerichtet ist. Die Desktop-App
öffnet [note.gitools.net](https://note.gitools.net) und benötigt eine
Internetverbindung. Änderungen an Oberfläche und allgemeinen Funktionen werden über
Web-Deployments ausgeliefert.

[Code signing policy](docs/CODE_SIGNING.md)

Installation per Homebrew unter macOS, lokale Ausführung, plattformspezifische
Paketierung und den Release-Ablauf beschreibt die [Desktop-Dokumentation](docs/DESKTOP.md).

## Betrieb und Entwicklung

Bei Änderungen an der Web-App werden die Abhängigkeiten anhand der Lock-Datei
installiert, und vor dem Deployment müssen statische Prüfungen, Tests und der
Produktions-Build erfolgreich durchlaufen. Die App wird als statische Dateien
bereitgestellt; Paketierung und Signierung der Desktop-App werden getrennt vom
Web-Deployment verwaltet. Bei Änderungen, die Datenformate oder Sicherheit betreffen,
sollten zuerst die Dokumente zu Anhängen und Verschlüsselung geprüft werden.
Entwicklungsumgebung, Prüfbefehle sowie Deployment- und Wartungsabläufe sind in der
[Entwicklungs- und Betriebsdokumentation](docs/DEVELOPMENT.md) beschrieben.

## Feature-Wünsche

Wenn du dir eine Funktion wünschst, forke das Projekt und ändere es selbst. Für meine
Zwecke reicht es bereits, daher nehme ich keine Feature-Vorschläge an.

## Lizenz

[MIT License](LICENSE)
