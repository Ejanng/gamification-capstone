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
}

registerRoutes('users', 'users.json');
registerRoutes('quizzes', 'quizzes.json');
registerRoutes('results', 'results.json');

// ---------- Start server ----------
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});