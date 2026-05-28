import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const isOpenAIConfigured = process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'YOUR_OPENAI_API_KEY';

// Fallback to Groq using OpenAI SDK compatibility if OpenAI Key is not set
export const openai = new OpenAI(
  isOpenAIConfigured
    ? { apiKey: process.env.OPENAI_API_KEY }
    : {
        apiKey: process.env.GROQ_API_KEY,
        baseURL: 'https://api.groq.com/openai/v1'
      }
);

export const AI_MODEL = isOpenAIConfigured ? 'gpt-4o-mini' : 'llama-3.1-8b-instant';

console.log(`🤖 AI Engine configured. Model: ${AI_MODEL}. Using: ${isOpenAIConfigured ? 'OpenAI Direct' : 'Groq compatibility'}`);
