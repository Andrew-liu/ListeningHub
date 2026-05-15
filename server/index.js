const express = require('express');
const cors = require('cors');
const path = require('path');
const { getDb } = require('./db');

const authRoutes = require('./routes/auth');
const syncRoutes = require('./routes/sync');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Initialize database
getDb();

// Routes
app.use('/api', authRoutes);
app.use('/api', syncRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Listening Hub API] Running on port ${PORT}`);
});

module.exports = app;
