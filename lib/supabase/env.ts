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

export type SupabaseServiceRoleEnv = {
  serviceRoleKey: string;
  url: string;
};

// NEXT_PUBLIC_を付けないため、クライアントバンドルへは含まれない
// (Issue #70: service_role専用境界を持つRPC呼び出し専用)。
export function getSupabaseServiceRoleEnv(
  environment: PublicEnvironment = process.env,
): SupabaseServiceRoleEnv {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY;

  if (url === undefined || serviceRoleKey === undefined) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください。",
    );
  }

  return { serviceRoleKey, url };
}
