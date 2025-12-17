require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const path = require('path');

const app = express();

// Middleware
app.use(cors({
  origin: process.env.BUBBLE_DOMAIN || '*',
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, WebP, and GIF allowed.'));
    }
  }
});

// OpenAI Vision API call
async function callOpenAIVision(imageBase64, prompt = null) {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  
  if (!openaiApiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const defaultPrompt = `Analyze this image from a building inspection. Provide:
1. A detailed description of what you observe
2. Any potential safety concerns or issues
3. Risk assessment (Low/Medium/High)
4. Recommended actions`;

  const messageContent = [
    {
      type: "image_url",
      image_url: {
        url: `data:image/jpeg;base64,${imageBase64}`,
        detail: "high"
      }
    },
    {
      type: "text",
      text: prompt || defaultPrompt
    }
  ];

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4-vision-preview',
        messages: [
          {
            role: 'user',
            content: messageContent
          }
        ],
        max_tokens: 1500,
        temperature: 0.7
      },
      {
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      success: true,
      description: response.data.choices[0].message.content,
      usage: {
        prompt_tokens: response.data.usage.prompt_tokens,
        completion_tokens: response.data.usage.completion_tokens
      }
    };
  } catch (error) {
    console.error('OpenAI API Error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.error?.message || 'Failed to process image with OpenAI Vision');
  }
}

// Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Process image endpoint
app.post('/api/process-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const imageBase64 = req.file.buffer.toString('base64');
    const customPrompt = req.body.prompt || null;

    console.log(`Processing image: ${req.file.originalname}`);

    const result = await callOpenAIVision(imageBase64, customPrompt);

    res.json({
      success: true,
      filename: req.file.originalname,
      description: result.description,
      usage: result.usage,
      processedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error processing image:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to process image'
    });
  }
});

// Process base64 image endpoint
app.post('/api/process-base64', async (req, res) => {
  try {
    const { imageBase64, prompt } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: 'No image data provided' });
    }

    let cleanBase64 = imageBase64;
    if (imageBase64.includes(',')) {
      cleanBase64 = imageBase64.split(',')[1];
    }

    console.log('Processing base64 image from Bubble');

    const result = await callOpenAIVision(cleanBase64, prompt);

    res.json({
      success: true,
      description: result.description,
      usage: result.usage,
      processedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error processing base64 image:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to process image'
    });
  }
});

// Test endpoint
app.post('/api/test', (req, res) => {
  res.json({
    message: 'Backend is working correctly',
    apiKey: process.env.OPENAI_API_KEY ? '✓ Configured' : '✗ Missing',
    bubbleDomain: process.env.BUBBLE_DOMAIN || 'Not restricted'
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
