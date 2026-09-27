const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// ---------- Middleware ----------
app.use(cors()); // allows your frontend (opened via Live Server / file:// / different port) to call this API
app.use(express.json()); // parses incoming JSON request bodies
app.use(express.static(path.join(__dirname, 'public'))); // serves your frontend if placed in /public

// ---------- Helper: generic file read/write ----------
const DATA_DIR = path.join(__dirname, 'data');

function getFilePath(filename) {
  return path.join(DATA_DIR, filename);
}

function readJSON(filename) {
  const filePath = getFilePath(filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`${filename} not found`);
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

function writeJSON(filename, data) {
  const filePath = getFilePath(filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ---------- Generic GET/POST factory ----------
// This avoids repeating the same boilerplate for each of the 3 files.
function registerRoutes(resourceName, filename) {
  // GET /api/users -> returns entire file contents
  app.get(`/api/${resourceName}`, (req, res) => {
    try {
      const data = readJSON(filename);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/users -> overwrites/appends depending on your frontend logic.
  // Here we assume the file's top-level shape is an array, and POST appends a new record.
  app.post(`/api/${resourceName}`, (req, res) => {
    try {
      const data = readJSON(filename);
      const newRecord = req.body;

      if (!newRecord || Object.keys(newRecord).length === 0) {
        return res.status(400).json({ error: 'Request body is empty' });
      }

      data.push(newRecord);
      writeJSON(filename, data);

      res.status(201).json({ message: `${resourceName} record added`, record: newRecord });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/users -> replaces the ENTIRE file contents.
  // Useful when the frontend needs to update points/levels in-place rather than append.
  app.put(`/api/${resourceName}`, (req, res) => {
    try {
      const newData = req.body;
      if (!Array.isArray(newData)) {
        return res.status(400).json({ error: 'Body must be an array' });
      }
      writeJSON(filename, newData);
      res.json({ message: `${resourceName} file replaced`, count: newData.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/users/:id -> updates one record by id, merging in whatever fields are sent.
  app.patch(`/api/${resourceName}/:id`, (req, res) => {
    try {
      const data = readJSON(filename);
      const index = data.findIndex(record => record.id === req.params.id);
      if (index === -1) {
        return res.status(404).json({ error: `${resourceName} record ${req.params.id} not found` });
      }
      data[index] = { ...data[index], ...req.body, id: data[index].id };
      writeJSON(filename, data);
      res.json({ message: `${resourceName} record updated`, record: data[index] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/users/:id -> removes one record by id.
  app.delete(`/api/${resourceName}/:id`, (req, res) => {
    try {
      const data = readJSON(filename);
      const index = data.findIndex(record => record.id === req.params.id);
      if (index === -1) {
        return res.status(404).json({ error: `${resourceName} record ${req.params.id} not found` });
      }
      const [removed] = data.splice(index, 1);
      writeJSON(filename, data);
      res.json({ message: `${resourceName} record deleted`, record: removed });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

registerRoutes('users', 'users.json');
registerRoutes('quizzes', 'quizzes.json');
registerRoutes('results', 'results.json');
registerRoutes('teachers', 'teachers.json');
registerRoutes('rewards', 'rewards.json');
registerRoutes('redemptions', 'redemptions.json');

// Cancel a pending redemption and return its points to the student.
app.post('/api/redemptions/:id/cancel', (req, res) => {
  try {
    const redemptions = readJSON('redemptions.json');
    const redemptionIndex = redemptions.findIndex(r => r.id === req.params.id);
    if (redemptionIndex === -1) {
      return res.status(404).json({ error: 'Redemption not found' });
    }

    const redemption = redemptions[redemptionIndex];
    if (redemption.status === 'claimed') {
      return res.status(400).json({ error: 'A claimed redemption cannot be cancelled' });
    }

    const users = readJSON('users.json');
    const userIndex = users.findIndex(user => user.id === redemption.userId);
    if (userIndex === -1) {
      return res.status(404).json({ error: 'Student not found' });
    }

    users[userIndex].points = (users[userIndex].points || 0) + redemption.point_cost;
    redemptions.splice(redemptionIndex, 1);
    writeJSON('users.json', users);
    writeJSON('redemptions.json', redemptions);

    res.json({
      message: 'Redemption cancelled',
      record: redemption,
      restoredPoints: redemption.point_cost,
      remainingPoints: users[userIndex].points
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Redeem a reward (atomic: deduct points + log the redemption together) ----------
// Doing this as one dedicated endpoint (rather than the client reading users.json,
// subtracting locally, then PUTting the whole array back) avoids a race condition
// where two quick clicks — or two students' requests overlapping — could both read
// the same "before" points value and only one deduction would stick.
app.post('/api/redeem', (req, res) => {
  try {
    const { userId, rewardId } = req.body;
    if (!userId || !rewardId) {
      return res.status(400).json({ error: 'userId and rewardId are required' });
    }

    const users = readJSON('users.json');
    const userIndex = users.findIndex(u => u.id === userId);
    if (userIndex === -1) return res.status(404).json({ error: 'Student not found' });

    const rewards = readJSON('rewards.json');
    const reward = rewards.find(r => r.id === rewardId);
    if (!reward) return res.status(404).json({ error: 'Reward not found' });

    const user = users[userIndex];
    if ((user.points || 0) < reward.point_cost) {
      return res.status(400).json({ error: 'Not enough points to redeem this reward' });
    }

    // Deduct and persist.
    user.points = user.points - reward.point_cost;
    writeJSON('users.json', users);

    // Log the redemption for the teacher's audit trail / physical hand-out record.
    const redemptions = readJSON('redemptions.json');
    const redemptionRecord = {
      id: `rd_${Date.now()}`,
      userId: user.id,
      studentName: user.name,
      rewardId: reward.id,
      reward_name: reward.reward_name,
      point_cost: reward.point_cost,
      remainingPoints: user.points,
      status: 'pending', // 'pending' until a teacher confirms physical hand-out, then 'claimed'
      claimedAt: null,
      timestamp: new Date().toISOString()
    };
    redemptions.push(redemptionRecord);
    writeJSON('redemptions.json', redemptions);

    res.status(201).json({
      message: 'Reward redeemed',
      remainingPoints: user.points,
      redemption: redemptionRecord
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Auth (simple, capstone-scope only — NOT production security) ----------
// Students "log in" by picking their existing record from users.json; no password.
app.post('/api/auth/student-login', (req, res) => {
  try {
    const { studentId } = req.body;
    if (!studentId) return res.status(400).json({ error: 'studentId is required' });

    const users = readJSON('users.json');
    const user = users.find(u => u.id === studentId);
    if (!user) return res.status(404).json({ error: 'Student not found' });

    res.json({ id: user.id, name: user.name, section: user.section || null, role: 'student' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Teachers log in with a username + password checked against teachers.json (plain text —
// fine for a local capstone demo, do NOT reuse this pattern for anything real).
app.post('/api/auth/teacher-login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }

    const teachers = readJSON('teachers.json');
    const teacher = teachers.find(t => t.username === username && t.password === password);
    if (!teacher) return res.status(401).json({ error: 'Invalid username or password' });

    res.json({ id: teacher.id, name: teacher.name, username: teacher.username, role: 'teacher' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Start server ----------
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});