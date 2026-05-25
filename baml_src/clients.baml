retry_policy Resilient {
  max_retries 3
  strategy {
    type exponential_backoff
    delay_ms 500
    multiplier 1.5
    max_delay_ms 10000
  }
}

client<llm> GeminiFlash {
  provider google-ai
  options {
    model "gemini-2.5-flash"
    api_key env.GOOGLE_API_KEY
  }
  retry_policy Resilient
}
