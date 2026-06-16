# BillCal — Product Requirements

## Overview
BillCal is an Outlook-style calendar mobile app for tracking bills, sending reminders, and viewing connected (mock) bank accounts. Built with Expo SDK 54 + FastAPI + MongoDB.

## User choices (gathered)
- **Bank sync**: Mock bank sync (UI demo with fake data)
- **Reminders**: Local device notifications via `expo-notifications`
- **Auth**: Email/password (JWT)
- **Theme**: Auto (system light/dark)
- **Core features**: calendar view (month) with bills marked, add/edit/delete bills (with recurrence), categories, mark paid/unpaid, upcoming summary, total due this month

## Core Features
1. **Auth**: Register & login (JWT, bcrypt-hashed passwords)
2. **Calendar tab**: Outlook-style month grid with bill dots; tap a date to see agenda
3. **Bills tab**: Dashboard hero (total due this month, upcoming count) + segmented filter (Upcoming / Paid / All) + bill list with toggle paid
4. **Bill editor**: Add/edit/delete bills with title, amount, due date, category, recurrence, notes
5. **Bank tab**: Mock bank accounts (checking/savings/credit) and recent transactions with a "Sync" action
6. **Settings tab**: Profile, notifications toggle (requests permission), theme info, logout
7. **Local notifications**: Schedule 24h-before-due reminders per bill (native only)

## API Endpoints
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `GET/POST /api/bills`, `GET/PUT/DELETE /api/bills/{id}`, `POST /api/bills/{id}/toggle_paid`
- `GET /api/bank/accounts`, `GET /api/bank/transactions`, `POST /api/bank/sync`

## Tech Stack
- Backend: FastAPI, MongoDB (motor), PyJWT, bcrypt
- Frontend: Expo Router v6, React Native 0.81, AsyncStorage, expo-notifications, expo-device, Ionicons

## Mocked / Limitations
- **Bank sync is MOCKED**: 3 fake accounts + 8 fake transactions per new user. The `Sync` button only updates a timestamp.
- **Notifications**: Local-only (no push). Reminders fire only on real devices/builds — not Expo Go on web.
