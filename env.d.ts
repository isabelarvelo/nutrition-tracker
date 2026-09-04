declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    FILES: R2Bucket;
    USDA_API_KEY?: string;
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
    OPENAI_VISION_MODEL?: string;
    OPENAI_TRANSCRIBE_MODEL?: string;
  }
}
