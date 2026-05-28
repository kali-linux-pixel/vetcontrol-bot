import express from 'express';
import cors from 'cors';
import webhookRoutes from './routes/webhook.js';

const app = express();

app.use(cors({
  origin: '*', // Allow connections from panel
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Core webhook routes
app.use('/api', webhookRoutes);

// Health check endpoint
const express = require("express");
const app = express();

app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    time: new Date().toISOString(),
  });
});

app.listen(3001, () => {
  console.log("Server running");
});