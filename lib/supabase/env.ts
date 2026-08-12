type PublicEnvironment = Record<string, string | undefined>;

export type SupabasePublicEnv = {
  publishableKey: string;
  url: string;
};

export function getSupabasePublicEnv(
  environment: PublicEnvironment = process.env,
): SupabasePublicEnv {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (url === undefined || publishableKey === undefined) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL と NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY を設定してください。",
    );
  }

  return { publishableKey, url };
}
