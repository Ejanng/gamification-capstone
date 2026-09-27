# Gamification & Academic Performance — Capstone Project

A research capstone platform that measures whether gamification (points, levels,
leaderboards) affects academic performance. Students take a **Pre-Test**, then
a **Gamified Activity** phase, then a **Post-Test**, and the results are
statistically analyzed to see if the gamified phase produced a measurable
improvement.

---

## Tech Stack

- **Frontend:** Vanilla HTML, CSS, JavaScript (no frameworks)
- **Backend:** Node.js + Express — a lightweight local API server
- **Storage:** Local JSON files (`data/users.json`, `data/quizzes.json`,
  `data/results.json`, `data/teachers.json`) — no database
- **Analysis:** Python (`pandas` + `scipy.stats`) for the Chapter 4 statistics

---

## Project Structure

```
gamification-capstone/
├── data/
│   ├── users.json        # Student accounts: points, level, section
│   ├── quizzes.json      # Quiz definitions (questions, choices, quiz type)
│   ├── results.json      # Every quiz attempt (score, answers, quiz_type, timestamp)
│   └── teachers.json     # Teacher login accounts
├── public/
│   ├── index.html              # Landing page — choose Student or Teacher
│   ├── student-login.html      # Student picks their name from the roster
│   ├── teacher-login.html      # Teacher signs in with username + password
│   ├── student-dashboard.html  # Student's list of quizzes (to do / completed)
│   ├── student-app.html        # The quiz-taking interface + gamification HUD
│   ├── teacher-dashboard.html  # Quiz Creator + Quiz List + Student Progress table
│   ├── app.js                  # Logic for student-app.html
│   └── teacher.js              # Logic for teacher-dashboard.html
├── private/
│   └── analyze_results.py      # Chapter 4 statistical analysis script
├── server.js              # Express server + API routes
├── package.json
└── README.md
```

---

## Setup

**Requirements:** Node.js, npm, and Python 3 (for the analysis script only).

```bash
git clone git@github.com:Ejanng/gamification-capstone.git
cd gamification-capstone
npm install
```

---

## Running the App

```bash
npm start
```

This starts the Express server at **http://localhost:3000** and serves the
frontend from `public/`. Leave this terminal running while students/teachers
use the app.

Open your browser to:

```
http://localhost:3000/
```

Always go through `localhost:3000` — do **not** open the HTML files directly
via `file://`, since the frontend calls the API with relative `fetch()` paths
that only work when served by the Express server.

Stop the server with `Ctrl + C`.

---

## Logging In

### Students
No password — pick your name from the class roster dropdown on the student
login page. This is intentionally simple for classroom use, **not** secure
for unsupervised/public deployment (see [Limitations](#limitations--known-trade-offs)).

### Teachers
Default demo account, defined in `data/teachers.json`:

| Username  | Password       |
|-----------|----------------|
| `teacher` | `capstone2026` |

Add more teacher accounts by editing `data/teachers.json` directly (plain
JSON, same shape as the sample entry).

---

## Core Features

### Student
- Log in, see a dashboard of assigned quizzes marked **To do** / **Completed**
- Take a quiz with a live timer per question
- Gamification HUD: total points, level, XP progress bar (hidden automatically
  during Pre-Test/Post-Test — see below)
- Live leaderboard sorted by total points
- Auto-redirected back to the dashboard after finishing a quiz

### Teacher
- Log in, build a quiz: title, subject, time limit, points per correct
  answer, and any number of questions/choices
- Flag each quiz as **Pre-Test**, **Gamified Activity**, or **Post-Test**
- View, edit, or delete any saved quiz
- View a live Student Progress table: rank, level, points, quizzes
  completed, completion %  — searchable by name

### Test Mode (Pre-Test / Post-Test)
Quizzes flagged `pre-test` or `post-test` automatically:
- Hide the HUD (points/level/progress bar) and the leaderboard from the student
- Skip writing points/level changes to `users.json` (so a baseline test can't
  bump a student's level)
- Still record the attempt in `results.json`, tagged with `quiz_type`, so it's
  available for analysis

---

## API Reference

Base URL: `http://localhost:3000/api`

| Method | Endpoint                  | Description                                  |
|--------|----------------------------|-----------------------------------------------|
| GET    | `/users`                  | All student records                          |
| POST   | `/users`                  | Append a new student record                  |
| PUT    | `/users`                  | Replace the entire `users.json` array        |
| PATCH  | `/users/:id`               | Update one student by id                     |
| DELETE | `/users/:id`               | Remove one student by id                     |
| GET    | `/quizzes`                | All quizzes                                  |
| POST   | `/quizzes`                | Add a new quiz                               |
| PATCH  | `/quizzes/:id`             | Edit one quiz by id                          |
| DELETE | `/quizzes/:id`             | Delete one quiz by id                        |
| GET    | `/results`                | All quiz attempts                            |
| POST   | `/results`                | Add a new attempt record                     |
| GET    | `/teachers`                | All teacher accounts                         |
| POST   | `/auth/student-login`      | Body: `{ studentId }` → returns session info |
| POST   | `/auth/teacher-login`      | Body: `{ username, password }` → session info|

All data is read from and written to the JSON files in `data/` — there is no
database.

---

## Running the Chapter 4 Analysis

Once real Pre-Test / Gamified / Post-Test data has been collected:

```bash
pip install pandas scipy
python3 private/analyze_results.py
```

Run this from the **project root** (not from inside `private/`) — the script
looks for `data/users.json` and `data/results.json` as relative paths.

It calculates and prints:
1. A **paired t-test** comparing Pre-Test vs. Post-Test scores
2. A **Pearson correlation** between total gamification points and score
   improvement (Post-Test − Pre-Test)
3. Plain-language interpretation of the p-value and r-value for the study's
   hypothesis

This script is independent of the running server — it just reads the JSON
files directly off disk.

---

## Data Schemas

**`users.json`**
```json
{
  "id": "u001",
  "name": "Juan Dela Cruz",
  "section": "12-STEM A",
  "points": 150,
  "level": 2,
  "badges": ["fast_learner"],
  "dateCreated": "2026-09-01T08:00:00.000Z"
}
```

**`quizzes.json`**
```json
{
  "id": "q001",
  "title": "Photosynthesis Basics",
  "subject": "Biology",
  "quizType": "gamified",
  "pointsPerCorrect": 10,
  "timeLimitSeconds": 300,
  "questions": [
    {
      "id": "q001_1",
      "prompt": "What gas do plants absorb during photosynthesis?",
      "options": ["Oxygen", "Carbon Dioxide", "Nitrogen", "Hydrogen"],
      "correctAnswerIndex": 1
    }
  ]
}
```

**`results.json`**
```json
{
  "id": "r001",
  "userId": "u001",
  "quizId": "q001",
  "quiz_type": "pre-test",
  "score": 8,
  "totalPossible": 10,
  "correctCount": 1,
  "incorrectCount": 1,
  "timeTakenSeconds": 187,
  "pointsEarned": 10,
  "answers": [
    { "questionId": "q001_1", "selectedIndex": 1, "isCorrect": true }
  ],
  "timestamp": "2026-09-15T09:30:00.000Z"
}
```

**`teachers.json`**
```json
{
  "id": "t001",
  "name": "Mr. Santos",
  "username": "teacher",
  "password": "capstone2026"
}
```

---

## Gamification Formulas

- **Level:** `Level = floor(sqrt(TotalPoints / 100)) + 1`
- **Points earned per correct answer:** base points + a time bonus (up to
  +50% for answering instantly, tapering to 0 at the question's time limit)

---

## Limitations & Known Trade-offs

- **No real authentication.** Student login has no password; teacher
  passwords are stored in plain text in `teachers.json`. This is a deliberate
  simplification for a supervised classroom setting, not something to expose
  publicly or reuse in a production system.
- **No database.** Concurrent writes from many students at the exact same
  moment could race, since each write reads-modifies-writes a whole JSON
  file. Fine at classroom scale; not built for high concurrency.
- **First attempt only.** The analysis script uses each student's *first*
  Pre-Test and Post-Test attempt if there are duplicates — retakes aren't
  averaged unless you edit `analyze_results.py`.

---

## License

Academic capstone project — for coursework use.
