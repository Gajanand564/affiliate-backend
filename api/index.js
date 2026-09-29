// Vercel serverless entry point — every request under /api/* and /uploads/*
// (see vercel.json rewrites) lands here and is handed to the Express app
// exported from server.js.
module.exports = require("../server");
