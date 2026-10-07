// Custom application error class preserving HTTP status
export class AppError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'AppError';
  }
}

// Maps LLM/provider errors to safe, friendly messages without exposing secrets
export function mapAiErrorToMessage(error) {
  if (!error) return 'AI assistant encountered an unexpected issue.';

  const message = error.message || '';
  const status = error.status || error.statusCode || error.response?.status;

  if (status === 429 || /rate limit|quota|429/i.test(message)) {
    return 'AI rate limit reached. Please wait a moment and try again.';
  }
  if (status === 503 || /503|unavailable|overloaded/i.test(message)) {
    return 'AI service is currently busy. Please try again shortly.';
  }
  if (status === 404 || /404|not found/i.test(message)) {
    return 'AI model not found. Check GEMINI_MODEL configuration.';
  }
  if (status === 400 || status === 401 || status === 403 || /API_KEY_INVALID|unauthorized|forbidden|401|403/i.test(message)) {
    return 'Invalid or unauthorized AI API key.';
  }
  if (/timeout|timed out|abort/i.test(message)) {
    return 'AI request timed out. Please try again.';
  }
  if (/empty|no candidates|empty response/i.test(message)) {
    return 'AI returned an empty response.';
  }

  return 'AI assistant encountered an issue. Please try again.';
}
