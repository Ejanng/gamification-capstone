// ============================================================
// CONFIG
// ============================================================
const API_BASE = '/api';

// ============================================================
// AUTH GUARD
// ============================================================
function getSession() {
  const raw = localStorage.getItem('session');
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    return session.role === 'teacher' ? session : null;
  } catch {
    return null;
  }
}

const session = getSession();
if (!session) {
  window.location.href = 'teacher-login.html';
}

// ============================================================
// STATE
// ============================================================
let editingQuizId = null; // null = creating a new quiz; otherwise the quiz id being edited
let questionCounter = 1;  // next index to use when adding a question block (0 is the static example)

// ============================================================
// DOM REFERENCES
// ============================================================
const dom = {
  teacherIdentity: document.getElementById('teacher-identity'),
  logoutBtn: document.getElementById('logout-btn'),

  quizForm: document.getElementById('quiz-creator-form'),
  titleInput: document.getElementById('quiz-title-input'),
  subjectInput: document.getElementById('quiz-subject-input'),
  timeLimitInput: document.getElementById('quiz-time-limit-input'),
  typeSelect: document.getElementById('quiz-type-select'),
  pointsInput: document.getElementById('quiz-points-input'),
  questionsContainer: document.getElementById('questions-container'),
  addQuestionBtn: document.getElementById('add-question-btn'),
  saveQuizBtn: document.getElementById('save-quiz-btn'),
  resetFormBtn: document.getElementById('reset-quiz-form-btn'),

  quizList: document.getElementById('quiz-list'),
  quizListEmpty: document.getElementById('quiz-list-empty'),

  progressTbody: document.getElementById('student-progress-tbody'),
  searchInput: document.getElementById('student-search-input'),
  refreshBtn: document.getElementById('refresh-progress-btn')
};

// ============================================================
// INIT
// ============================================================
function init() {
  dom.teacherIdentity.textContent = session.name || 'Teacher view';

  dom.logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('session');
    window.location.href = 'index.html';
  });

  dom.addQuestionBtn.addEventListener('click', addQuestionBlock);
  dom.quizForm.addEventListener('submit', handleQuizFormSubmit);
  dom.resetFormBtn.addEventListener('click', exitEditMode);

  dom.refreshBtn.addEventListener('click', renderStudentProgress);
  dom.searchInput.addEventListener('input', renderStudentProgress);

  // Replace the static placeholder question block in the HTML with one built
  // the same way dynamically-added ones are, so it also gets a Remove button.
  exitEditMode();

  renderQuizList();
  renderStudentProgress();
}

// ============================================================
// QUESTION BLOCK BUILDER
// (used both by "+ Add question" and by "Edit" pre-filling the form)
// ============================================================
function buildQuestionBlock(index, questionData) {
  const data = questionData || { prompt: '', options: ['', '', '', ''], correctAnswerIndex: 0 };

  const fieldset = document.createElement('fieldset');
  fieldset.className = 'question-block';
  fieldset.dataset.questionIndex = index;

  const letters = ['A', 'B', 'C', 'D'];
  const choiceRowsHtml = letters.map((letter, i) => `
    <div class="choice-row">
      <input type="radio" name="question-${index}-correct" value="${i}"
             id="question-${index}-choice-${i}-correct" ${data.correctAnswerIndex === i ? 'checked' : ''}>
      <input type="text" class="choice-input" id="question-${index}-choice-${i}" placeholder="Choice ${letter}">
    </div>
  `).join('');

  fieldset.innerHTML = `
    <legend>Question ${index + 1}</legend>
    <div class="field-group">
      <label for="question-${index}-prompt">Question prompt</label>
      <input type="text" id="question-${index}-prompt" class="question-prompt-input" placeholder="Enter the question">
    </div>
    ${choiceRowsHtml}
    <button type="button" class="btn btn-secondary btn-sm remove-question-btn" style="align-self:flex-start;">Remove question</button>
  `;

  fieldset.querySelector('.question-prompt-input').value = data.prompt || '';
  data.options.forEach((optionText, i) => {
    const input = fieldset.querySelector(`#question-${index}-choice-${i}`);
    if (input) input.value = optionText || '';
  });

  fieldset.querySelector('.remove-question-btn').addEventListener('click', () => {
    // Keep at least one question in the form.
    if (dom.questionsContainer.querySelectorAll('.question-block').length <= 1) {
      alert('A quiz needs at least one question.');
      return;
    }
    fieldset.remove();
  });

  return fieldset;
}

function addQuestionBlock() {
  const block = buildQuestionBlock(questionCounter, null);
  dom.questionsContainer.appendChild(block);
  questionCounter += 1;
}

// ============================================================
// FORM <-> QUIZ OBJECT
// ============================================================
function readQuizFromForm() {
  const title = dom.titleInput.value.trim();
  const subject = dom.subjectInput.value.trim();
  const timeLimitSeconds = Number(dom.timeLimitInput.value) || 300;
  const quizType = dom.typeSelect.value;
  const pointsPerCorrect = Number(dom.pointsInput.value) || 10;

  const questionBlocks = Array.from(dom.questionsContainer.querySelectorAll('.question-block'));

  const questions = questionBlocks.map((block, i) => {
    const index = block.dataset.questionIndex;
    const prompt = block.querySelector('.question-prompt-input').value.trim();
    const options = Array.from(block.querySelectorAll('.choice-input')).map(inp => inp.value.trim());
    const checkedRadio = block.querySelector(`input[name="question-${index}-correct"]:checked`);
    const correctAnswerIndex = checkedRadio ? Number(checkedRadio.value) : 0;

    return {
      id: `${editingQuizId || 'q_new'}_${i + 1}`,
      prompt,
      options,
      correctAnswerIndex
    };
  });

  return { title, subject, timeLimitSeconds, quizType, pointsPerCorrect, questions };
}

function validateQuiz(quiz) {
  if (!quiz.title) return 'Quiz title is required.';
  if (!quiz.subject) return 'Subject is required.';
  if (!quiz.questions.length) return 'Add at least one question.';

  for (const q of quiz.questions) {
    if (!q.prompt) return 'Every question needs a prompt.';
    if (q.options.some(opt => !opt)) return 'Every choice needs text — fill in all four options.';
  }
  return null;
}

// ============================================================
// SAVE (CREATE OR UPDATE)
// ============================================================
async function handleQuizFormSubmit(e) {
  e.preventDefault();

  const quiz = readQuizFromForm();
  const validationError = validateQuiz(quiz);
  if (validationError) {
    alert(validationError);
    return;
  }

  dom.saveQuizBtn.disabled = true;
  dom.saveQuizBtn.textContent = editingQuizId ? 'Updating...' : 'Saving...';

  try {
    if (editingQuizId) {
      // Fix up question ids now that we know the real quiz id.
      quiz.questions.forEach((q, i) => { q.id = `${editingQuizId}_${i + 1}`; });

      const res = await fetch(`${API_BASE}/quizzes/${editingQuizId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(quiz)
      });
      if (!res.ok) throw new Error('Failed to update quiz');
    } else {
      const newId = `q_${Date.now()}`;
      quiz.id = newId;
      quiz.questions.forEach((q, i) => { q.id = `${newId}_${i + 1}`; });

      const res = await fetch(`${API_BASE}/quizzes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(quiz)
      });
      if (!res.ok) throw new Error('Failed to save quiz');
    }

    exitEditMode();
    await renderQuizList();

  } catch (err) {
    console.error(err);
    alert(err.message || 'Something went wrong saving the quiz.');
  } finally {
    dom.saveQuizBtn.disabled = false;
    dom.saveQuizBtn.textContent = editingQuizId ? 'Update quiz' : 'Save quiz';
  }
}

function exitEditMode() {
  editingQuizId = null;
  dom.saveQuizBtn.textContent = 'Save quiz';
  dom.quizForm.reset();

  // Reset questions container back to a single blank question block.
  dom.questionsContainer.innerHTML = '';
  dom.questionsContainer.appendChild(buildQuestionBlock(0, null));
  questionCounter = 1;
}

// ============================================================
// EDIT / DELETE
// ============================================================
function loadQuizIntoForm(quiz) {
  editingQuizId = quiz.id;

  dom.titleInput.value = quiz.title || '';
  dom.subjectInput.value = quiz.subject || '';
  dom.timeLimitInput.value = quiz.timeLimitSeconds || 300;
  dom.typeSelect.value = quiz.quizType || 'gamified';
  dom.pointsInput.value = quiz.pointsPerCorrect || 10;

  dom.questionsContainer.innerHTML = '';
  (quiz.questions || []).forEach((q, i) => {
    dom.questionsContainer.appendChild(buildQuestionBlock(i, q));
  });
  questionCounter = (quiz.questions || []).length;

  dom.saveQuizBtn.textContent = 'Update quiz';
  document.getElementById('quiz-creator-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function deleteQuiz(quizId) {
  if (!confirm('Delete this quiz? This cannot be undone. Existing student results for it will be kept.')) {
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/quizzes/${quizId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete quiz');

    if (editingQuizId === quizId) exitEditMode();
    await renderQuizList();
  } catch (err) {
    console.error(err);
    alert('Could not delete this quiz.');
  }
}

// ============================================================
// QUIZ LIST RENDERING
// ============================================================
const quizTypeLabels = {
  'pre-test': 'Pre-Test',
  'post-test': 'Post-Test',
  'gamified': 'Gamified Activity'
};

async function renderQuizList() {
  try {
    const res = await fetch(`${API_BASE}/quizzes`);
    if (!res.ok) throw new Error('Failed to fetch quizzes');
    const quizzes = await res.json();

    dom.quizList.innerHTML = '';

    if (!quizzes.length) {
      dom.quizListEmpty.style.display = 'block';
      return;
    }
    dom.quizListEmpty.style.display = 'none';

    quizzes.forEach(quiz => {
      const quizType = quiz.quizType || 'gamified';

      const item = document.createElement('div');
      item.className = 'quiz-list-item';
      item.dataset.quizId = quiz.id;

      item.innerHTML = `
        <div class="quiz-list-item-info">
          <div class="quiz-list-item-title"></div>
          <div class="quiz-list-item-meta">
            <span class="quiz-type-tag ${quizType}">${quizTypeLabels[quizType] || quizType}</span>
            <span></span>
            <span>${(quiz.questions || []).length} question${(quiz.questions || []).length === 1 ? '' : 's'}</span>
          </div>
        </div>
        <div class="quiz-list-item-actions">
          <button type="button" class="btn btn-secondary btn-sm edit-quiz-btn">Edit</button>
          <button type="button" class="btn btn-danger btn-sm delete-quiz-btn">Delete</button>
        </div>
      `;

      item.querySelector('.quiz-list-item-title').textContent = quiz.title;
      item.querySelector('.quiz-list-item-meta span:nth-child(2)').textContent = quiz.subject || '';

      item.querySelector('.edit-quiz-btn').addEventListener('click', () => loadQuizIntoForm(quiz));
      item.querySelector('.delete-quiz-btn').addEventListener('click', () => deleteQuiz(quiz.id));

      dom.quizList.appendChild(item);
    });

  } catch (err) {
    console.error('Failed to render quiz list:', err);
    dom.quizList.innerHTML = '<p style="color:var(--ink-muted); font-size:13.5px;">Could not load quizzes.</p>';
  }
}

// ============================================================
// STUDENT PROGRESS TABLE
// ============================================================
async function renderStudentProgress() {
  try {
    const [usersRes, resultsRes, quizzesRes] = await Promise.all([
      fetch(`${API_BASE}/users`),
      fetch(`${API_BASE}/results`),
      fetch(`${API_BASE}/quizzes`)
    ]);
    const users = await usersRes.json();
    const results = await resultsRes.json();
    const quizzes = await quizzesRes.json();

    const totalQuizzes = quizzes.length;
    const searchTerm = dom.searchInput.value.trim().toLowerCase();

    const rows = users
      .map(user => {
        const userResults = results.filter(r => r.userId === user.id);
        const distinctQuizzesDone = new Set(userResults.map(r => r.quizId)).size;
        return { user, quizzesDone: distinctQuizzesDone };
      })
      .filter(row => !searchTerm || row.user.name.toLowerCase().includes(searchTerm))
      .sort((a, b) => (b.user.points || 0) - (a.user.points || 0));

    dom.progressTbody.innerHTML = '';

    if (!rows.length) {
      dom.progressTbody.innerHTML = `<tr><td colspan="7" class="empty-state">No students match.</td></tr>`;
      return;
    }

    rows.forEach((row, index) => {
      const { user, quizzesDone } = row;
      const completionPercent = totalQuizzes > 0 ? Math.round((quizzesDone / totalQuizzes) * 100) : 0;

      const tr = document.createElement('tr');
      tr.dataset.userId = user.id;
      tr.innerHTML = `
        <td class="rank-cell">${index + 1}</td>
        <td class="student-name-cell"></td>
        <td class="student-section-cell"></td>
        <td><span class="level-pill">Lvl ${user.level || 1}</span></td>
        <td class="points-cell">${user.points || 0}</td>
        <td>${quizzesDone} / ${totalQuizzes}</td>
        <td>
          <div class="completion-bar-track">
            <div class="completion-bar-fill" style="width:${completionPercent}%"></div>
          </div>
        </td>
      `;
      tr.querySelector('.student-name-cell').textContent = user.name;
      tr.querySelector('.student-section-cell').textContent = user.section || '—';

      dom.progressTbody.appendChild(tr);
    });

  } catch (err) {
    console.error('Failed to render student progress:', err);
    dom.progressTbody.innerHTML = `<tr><td colspan="7" class="empty-state">Could not load student progress.</td></tr>`;
  }
}

// ============================================================
// START
// ============================================================
document.addEventListener('DOMContentLoaded', init);
