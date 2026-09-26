// ============================================================
// CONFIG
// ============================================================
const API_BASE = '/api'; // same-origin since Express serves /public via express.static

// Placeholder until you build real auth — swap this for a proper
// login/session value in a later phase.
const CURRENT_USER_ID = 'u001';

// How much of a question's base points can be earned as a time bonus.
// 0.5 = up to +50% bonus for answering instantly, tapering to 0 at the deadline.
const TIME_BONUS_FACTOR = 0.5;

// Seconds allotted per question (falls back to quiz.timeLimitSeconds / question count if unset)
const DEFAULT_SECONDS_PER_QUESTION = 30;

// ============================================================
// STATE
// ============================================================
const state = {
  user: null,          // full user record from users.json
  quiz: null,           // full quiz record from quizzes.json
  currentQuestionIndex: 0,
  selectedChoiceIndex: null,
  answered: false,
  answers: [],           // { questionId, selectedIndex, isCorrect, pointsEarned }
  pointsEarnedThisQuiz: 0,
  questionStartTime: null,
  questionTimerInterval: null,
  secondsPerQuestion: DEFAULT_SECONDS_PER_QUESTION,
  secondsRemaining: DEFAULT_SECONDS_PER_QUESTION
};

// ============================================================
// DOM REFERENCES
// ============================================================
dom.hud = document.getElementById('gamification-hud');
dom.leaderboardPanel = document.getElementById('leaderboard-panel');

const dom = {
  studentName: document.getElementById('student-name-display'),
  currentLevel: document.getElementById('current-level-display'),
  totalPoints: document.getElementById('total-points-display'),
  progressBarFill: document.getElementById('progress-bar-fill'),
  progressBarLabel: document.getElementById('progress-bar-label'),

  quizTitle: document.getElementById('quiz-title-display'),
  quizTimer: document.getElementById('quiz-timer-display'),
  questionProgressFill: document.getElementById('question-progress-fill'),
  questionPrompt: document.getElementById('question-prompt-display'),
  choicesList: document.getElementById('choices-list'),
  submitBtn: document.getElementById('submit-answer-btn'),
  quizFeedback: document.getElementById('quiz-feedback'),

  leaderboardList: document.getElementById('leaderboard-list'),
  leaderboardUpdatedAt: document.getElementById('leaderboard-updated-at')
};

// ============================================================
// GAMIFICATION MATH
// ============================================================

// Level = floor(sqrt(TotalPoints / 100)) + 1
function calculateLevel(totalPoints) {
  return Math.floor(Math.sqrt(totalPoints / 100)) + 1;
}

// Inverse of the level formula: minimum points required to BE this level.
function pointsRequiredForLevel(level) {
  return 100 * Math.pow(level - 1, 2);
}

// Points needed to reach the NEXT level from here.
function pointsRequiredForNextLevel(level) {
  return 100 * Math.pow(level, 2);
}

// base points + time bonus. secondsRemaining/secondsAllotted gives a 0..1 fraction;
// faster answers earn a bigger slice of the bonus pool.
function calculatePointsEarned(basePoints, secondsRemaining, secondsAllotted) {
  const timeFraction = Math.max(0, Math.min(1, secondsRemaining / secondsAllotted));
  const bonus = Math.round(basePoints * TIME_BONUS_FACTOR * timeFraction);
  return basePoints + bonus;
}

// ============================================================
// INIT  (updated — call applyTestModeVisibility after quiz loads)
// ============================================================
async function init() {
  try {
    const [user, quiz] = await Promise.all([
      fetchCurrentUser(),
      fetchFirstQuiz()
    ]);

    state.user = user;
    state.quiz = quiz;

    state.secondsPerQuestion = quiz.questions.length
      ? Math.floor((quiz.timeLimitSeconds || DEFAULT_SECONDS_PER_QUESTION * quiz.questions.length) / quiz.questions.length)
      : DEFAULT_SECONDS_PER_QUESTION;

    applyTestModeVisibility(); // <-- NEW: hide HUD/leaderboard before anything renders

    renderHUD();      // safe to call even when hidden — just updates text/width offscreen
    renderQuestion();

    if (!isTestMode(quiz)) {
      await renderLeaderboard(); // don't bother fetching/rendering leaderboard during a test
    }

  } catch (err) {
    console.error('Failed to initialize student app:', err);
    dom.quizFeedback.textContent = 'Could not load quiz data. Is the server running?';
  }
}

// ============================================================
// FETCH HELPERS
// ============================================================
async function fetchCurrentUser() {
  const res = await fetch(`${API_BASE}/users`);
  if (!res.ok) throw new Error('Failed to fetch users.json');
  const users = await res.json();
  const user = users.find(u => u.id === CURRENT_USER_ID);
  if (!user) throw new Error(`User ${CURRENT_USER_ID} not found in users.json`);
  return user;
}

async function fetchFirstQuiz() {
  const res = await fetch(`${API_BASE}/quizzes`);
  if (!res.ok) throw new Error('Failed to fetch quizzes.json');
  const quizzes = await res.json();
  if (!quizzes.length) throw new Error('No quizzes available');
  return quizzes[0]; // Phase-4 TODO: let the student pick from a list instead
}

async function fetchAllUsers() {
  const res = await fetch(`${API_BASE}/users`);
  if (!res.ok) throw new Error('Failed to fetch users.json');
  return res.json();
}

// ============================================================
// HUD RENDERING
// ============================================================
function renderHUD() {
  const { name, points, level } = state.user;

  dom.studentName.textContent = name;
  dom.currentLevel.textContent = level;
  dom.totalPoints.textContent = points;

  updateProgressBar(points, level);
}

function updateProgressBar(totalPoints, level) {
  const currentLevelFloor = pointsRequiredForLevel(level);
  const nextLevelCeiling = pointsRequiredForNextLevel(level);
  const span = nextLevelCeiling - currentLevelFloor;
  const progressIntoLevel = totalPoints - currentLevelFloor;

  const percent = span > 0
    ? Math.max(0, Math.min(100, (progressIntoLevel / span) * 100))
    : 100;

  dom.progressBarFill.style.width = `${percent}%`;
  dom.progressBarLabel.textContent = `${totalPoints} / ${nextLevelCeiling} XP`;
}

// ============================================================
// QUIZ RENDERING
// ============================================================
function renderQuestion() {
  const question = state.quiz.questions[state.currentQuestionIndex];

  state.selectedChoiceIndex = null;
  state.answered = false;
  dom.quizFeedback.textContent = '';
  dom.submitBtn.disabled = false;
  dom.submitBtn.textContent = 'Submit answer';

  dom.quizTitle.textContent = state.quiz.title;
  dom.questionPrompt.textContent = question.prompt;

  const totalQuestions = state.quiz.questions.length;
  const progressPercent = ((state.currentQuestionIndex) / totalQuestions) * 100;
  dom.questionProgressFill.style.width = `${progressPercent}%`;

  dom.choicesList.innerHTML = '';
  question.options.forEach((optionText, index) => {
    const li = document.createElement('li');
    li.className = 'choice-option';
    li.dataset.choiceIndex = index;
    li.innerHTML = `
      <span class="choice-marker">${String.fromCharCode(65 + index)}</span>
      <span class="choice-text"></span>
    `;
    li.querySelector('.choice-text').textContent = optionText; // textContent avoids HTML injection
    li.addEventListener('click', () => selectChoice(index, li));
    dom.choicesList.appendChild(li);
  });

  startQuestionTimer();
}

function selectChoice(index, liElement) {
  if (state.answered) return;

  document.querySelectorAll('.choice-option').forEach(el => el.classList.remove('is-selected'));
  liElement.classList.add('is-selected');
  state.selectedChoiceIndex = index;
}

// ============================================================
// TIMER
// ============================================================
function startQuestionTimer() {
  clearInterval(state.questionTimerInterval);
  state.secondsRemaining = state.secondsPerQuestion;
  state.questionStartTime = Date.now();

  updateTimerDisplay();

  state.questionTimerInterval = setInterval(() => {
    state.secondsRemaining -= 1;
    updateTimerDisplay();

    if (state.secondsRemaining <= 0) {
      clearInterval(state.questionTimerInterval);
      if (!state.answered) submitAnswer(); // auto-submit (counts as wrong if nothing selected)
    }
  }, 1000);
}

function updateTimerDisplay() {
  const m = Math.floor(Math.max(0, state.secondsRemaining) / 60).toString().padStart(2, '0');
  const s = Math.max(0, state.secondsRemaining % 60).toString().padStart(2, '0');
  dom.quizTimer.textContent = `${m}:${s}`;
}

// ============================================================
// SUBMIT ANSWER  (updated — skip visible point popups during test mode)
// ============================================================
async function submitAnswer() {
  if (state.answered) return;
  state.answered = true;
  clearInterval(state.questionTimerInterval);
  dom.submitBtn.disabled = true;

  const question = state.quiz.questions[state.currentQuestionIndex];
  const isCorrect = state.selectedChoiceIndex === question.correctAnswerIndex;
  const testMode = isTestMode(state.quiz);

  document.querySelectorAll('.choice-option').forEach(el => {
    const idx = Number(el.dataset.choiceIndex);
    if (idx === question.correctAnswerIndex) el.classList.add('is-correct');
    else if (idx === state.selectedChoiceIndex) el.classList.add('is-incorrect');
  });

  let pointsEarned = 0;
  if (isCorrect) {
    pointsEarned = calculatePointsEarned(
      state.quiz.pointsPerCorrect,
      state.secondsRemaining,
      state.secondsPerQuestion
    );
    // During Pre/Post-Test, don't show point values or gamified language —
    // keep feedback neutral so it doesn't influence baseline performance.
    dom.quizFeedback.textContent = testMode ? 'Answer recorded.' : `Correct! +${pointsEarned} pts`;
    dom.quizFeedback.style.color = testMode ? 'var(--ink-muted)' : 'var(--teal)';
  } else {
    dom.quizFeedback.textContent = testMode ? 'Answer recorded.' : 'Incorrect.';
    dom.quizFeedback.style.color = testMode ? 'var(--ink-muted)' : 'var(--red)';
  }

  // We still calculate pointsEarned internally even in test mode — the research
  // data should retain the "would-be" score for comparison, we just don't display it.
  state.pointsEarnedThisQuiz += pointsEarned;
  state.answers.push({
    questionId: question.id,
    selectedIndex: state.selectedChoiceIndex,
    isCorrect,
    pointsEarned
  });

  if (!testMode) {
    const projectedTotal = state.user.points + state.pointsEarnedThisQuiz;
    dom.totalPoints.textContent = projectedTotal;
    updateProgressBar(projectedTotal, calculateLevel(projectedTotal));
  }

  await new Promise(resolve => setTimeout(resolve, testMode ? 400 : 1200));

  const isLastQuestion = state.currentQuestionIndex === state.quiz.questions.length - 1;
  if (isLastQuestion) {
    await finishQuiz();
  } else {
    state.currentQuestionIndex += 1;
    renderQuestion();
  }
}

// ============================================================
// FINISH QUIZ  (updated — stamp quiz_type, skip point-update UI + leaderboard in test mode)
// ============================================================
async function finishQuiz() {
  dom.questionProgressFill.style.width = '100%';

  const testMode = isTestMode(state.quiz);
  const newTotalPoints = state.user.points + state.pointsEarnedThisQuiz;
  const newLevel = calculateLevel(newTotalPoints);
  const correctCount = state.answers.filter(a => a.isCorrect).length;

  const resultRecord = {
    id: `r_${Date.now()}`,
    userId: state.user.id,
    quizId: state.quiz.id,
    quiz_type: state.quiz.quizType,          // <-- NEW: 'pre-test' | 'gamified' | 'post-test'
    score: state.pointsEarnedThisQuiz,
    totalPossible: state.quiz.questions.length * state.quiz.pointsPerCorrect,
    correctCount,
    incorrectCount: state.answers.length - correctCount,
    timeTakenSeconds: Math.round((Date.now() - (state.questionStartTime - 0)) / 1000),
    pointsEarned: state.pointsEarnedThisQuiz,
    answers: state.answers,
    timestamp: new Date().toISOString()
  };

  try {
    await postResult(resultRecord);

    if (testMode) {
      // Deliberately DO NOT write points/level to users.json during Pre/Post-Test.
      // This keeps the gamification system's state exactly as it was going into
      // the test, and prevents the baseline measurement from leaking into level-ups.
      dom.quizFeedback.textContent = 'Test submitted. Thank you.';
      dom.quizFeedback.style.color = 'var(--ink-muted)';
      dom.submitBtn.textContent = 'Test finished';
    } else {
      await updateUserPointsOnServer(newTotalPoints, newLevel);
      state.user.points = newTotalPoints;
      state.user.level = newLevel;

      dom.quizFeedback.textContent = `Quiz complete! Total: ${newTotalPoints} pts (Level ${newLevel})`;
      dom.quizFeedback.style.color = 'var(--gold)';
      dom.submitBtn.textContent = 'Quiz finished';

      renderHUD();
      await renderLeaderboard();
    }

  } catch (err) {
    console.error('Failed to save quiz results:', err);
    dom.quizFeedback.textContent = testMode
      ? 'Test submitted, but saving to server failed.'
      : 'Quiz complete, but saving to server failed.';
    dom.quizFeedback.style.color = 'var(--red)';
  }
}

// POST a new attempt record — matches the results.json array-append route from server.js
async function postResult(resultRecord) {
  const res = await fetch(`${API_BASE}/results`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(resultRecord)
  });
  if (!res.ok) throw new Error('Failed to POST result');
  return res.json();
}

// Updates points/level for the current user by replacing the full users.json array
// via PUT (server.js exposes PUT /api/users for whole-file replacement).
async function updateUserPointsOnServer(newPoints, newLevel) {
  const allUsers = await fetchAllUsers();
  const updatedUsers = allUsers.map(u =>
    u.id === state.user.id ? { ...u, points: newPoints, level: newLevel } : u
  );

  const res = await fetch(`${API_BASE}/users`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updatedUsers)
  });
  if (!res.ok) throw new Error('Failed to PUT updated users');
  return res.json();
}

// ============================================================
// LEADERBOARD
// ============================================================
async function renderLeaderboard() {
  try {
    const users = await fetchAllUsers();

    // Sort by points descending
    const ranked = [...users].sort((a, b) => b.points - a.points);

    dom.leaderboardList.innerHTML = '';
    ranked.forEach((user, index) => {
      const li = document.createElement('li');
      li.className = 'leaderboard-entry';
      if (user.id === CURRENT_USER_ID) li.classList.add('is-current-user');
      li.dataset.userId = user.id;

      li.innerHTML = `
        <span class="leaderboard-rank">${index + 1}</span>
        <span class="leaderboard-name"></span>
        <span class="leaderboard-points">${user.points}</span>
      `;
      li.querySelector('.leaderboard-name').textContent = user.name;

      dom.leaderboardList.appendChild(li);
    });

    dom.leaderboardUpdatedAt.textContent =
      `Updated ${new Date().toLocaleTimeString()}`;

  } catch (err) {
    console.error('Failed to render leaderboard:', err);
  }
}

// ============================================================
// TEST MODE HANDLING
// ============================================================

// A quiz counts as "test mode" (no gamification shown) if it's flagged
// pre-test or post-test. Anything else (including missing/legacy quizzes
// with no quizType) is treated as a normal gamified activity.
function isTestMode(quiz) {
  return quiz.quizType === 'pre-test' || quiz.quizType === 'post-test';
}

// Hides the HUD (points/level/progress bar) and the leaderboard sidebar
// so students see a neutral, ungamified quiz interface during Pre/Post-Tests.
function hideGamificationUI() {
  if (dom.hud) dom.hud.style.display = 'none';
  if (dom.leaderboardPanel) dom.leaderboardPanel.style.display = 'none';
}

// Restores the HUD and leaderboard for gamified activities.
function showGamificationUI() {
  if (dom.hud) dom.hud.style.display = '';
  if (dom.leaderboardPanel) dom.leaderboardPanel.style.display = '';
}

// Applies the correct visibility state based on the currently loaded quiz.
// Call this once the quiz is known (in init(), and again if you later let
// students switch quizzes without a full page reload).
function applyTestModeVisibility() {
  if (isTestMode(state.quiz)) {
    hideGamificationUI();
  } else {
    showGamificationUI();
  }
}

// ============================================================
// START
// ============================================================
document.addEventListener('DOMContentLoaded', init);