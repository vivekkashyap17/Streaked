# Streaked

A simple Android goal-tracker app. Add goals, tick them off each day, and watch your streaks grow. Built with Expo (React Native + TypeScript).

## Download

Grab the latest APK here: **[Download Streaked](https://expo.dev/accounts/vivek-kashyap/projects/streaked/builds/3d486028-7849-4b77-879b-488a7cfe3c34)**

> Android may warn about installing from an unknown source — allow it to continue.

## Features

- **Daily goals** — add goals and tick them done for the day
- **Streaks & totals** — current streak, best-ever streak, and lifetime total, all computed from your history
- **History view** — see the last 30 days at a glance
- **Calendar heatmap** — a GitHub-style weekly grid of done days per goal
- **Daily reminders** — an alarm-style notification per goal at a time you pick, with a choice of bundled sounds
- **Milestone celebrations** — a popup at 7, 30, and 100-day streaks
- **Notes & archiving** — add a note to a goal, or archive goals you no longer track
- **Reorder & sort** — arrange goals manually or sort by streak, to-do, or name
- **Dark mode & themes** — follows the system setting, or force Light/Dark
- **Backup** — export and import all your data as a JSON file

## Tech Stack

- **Expo** SDK 54
- **React Native** 0.81 / **React** 19.1
- **TypeScript** (strict)
- **AsyncStorage** for local persistence
- `expo-notifications`, `expo-audio`, `expo-file-system` and other Expo modules

Runs as an **EAS development build** (not Expo Go — Expo Go dropped Android notification support in SDK 53).

## Data Model

- **Goals** — the list of goals.
- **Daily Logs** — one record per goal per day: `{ goalId, date, done }`.
- Streaks and totals are **always computed from the logs at read time**, never stored.

## Getting Started

Install dependencies:

```bash
npm install
```

Start the dev server and open the app in the installed **Streaked** development build:

```bash
npx expo start --dev-client
```

Add `--tunnel` if the phone can't reach the computer over Wi-Fi.

Typecheck the project:

```bash
npx tsc --noEmit
```

## Building

Rebuild the development APK (only needed when a native dependency or native config changes):

```bash
eas build --platform android --profile development
```

Build a standalone APK for testing or sharing (installs and runs on its own — no dev server needed):

```bash
eas build --platform android --profile preview
```

## Project Structure

- `App.tsx` — the whole app (all screens and logic)
- `index.ts` — entry point
- `app.json` — Expo config (app name, icon, notification sounds, plugins)
- `eas.json` — EAS build profiles
- `assets/` — app icon, splash screen, and reminder sounds
