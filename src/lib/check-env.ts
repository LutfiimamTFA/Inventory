export const REQUIRED_FIREBASE_PUBLIC_ENV = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
] as const;

export type FirebasePublicEnvKey = (typeof REQUIRED_FIREBASE_PUBLIC_ENV)[number];

export function getMissingPublicEnv(
  values: Record<FirebasePublicEnvKey, string | undefined>
) {
  return REQUIRED_FIREBASE_PUBLIC_ENV.filter((key) => !values[key]?.trim());
}

export function formatMissingPublicEnvMessage(missing: readonly string[]) {
  return (
    `[Firebase Config] Missing environment variables: ${missing.join(", ")}. ` +
    "Set them in Vercel Project Settings > Environment Variables for Production, Preview, and Development."
  );
}

export function checkPublicEnv(
  values: Record<FirebasePublicEnvKey, string | undefined>
) {
  const missing = getMissingPublicEnv(values);
  if (missing.length > 0) {
    throw new Error(formatMissingPublicEnvMessage(missing));
  }
}
