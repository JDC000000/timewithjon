// tests/fixtures/google-env.ts — Google OAuth settings for tests that reach the real adapter code (against the
// fake Google in fake-google.ts). Import after the base env fixture and before anything calls getEnv().
import { TEST_CLIENT_ID, TEST_ENC_KEY, TEST_ENC_KEY_OLD } from './fake-google';

Object.assign(process.env, {
  GOOGLE_OAUTH_CLIENT_ID: TEST_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET: 'test-secret',
  GOOGLE_TOKEN_ENC_KEY: TEST_ENC_KEY,
  GOOGLE_TOKEN_ENC_KEY_PREVIOUS: TEST_ENC_KEY_OLD,
  JON_PERSONAL_EMAIL: 'jon.personal@example.com', // Reply-To only: J2 is the connected account (pr39 F2)
});
