export const E2E_WRANGLER_ENVIRONMENT = "e2e";
export const E2E_AUTH_SECRET = "yamoru-e2e-auth-secret-at-least-32-characters";

export function assertE2EWranglerEnvironment(environment: string): void {
  if (environment !== E2E_WRANGLER_ENVIRONMENT) {
    throw new Error(
      `E2EはWranglerの${E2E_WRANGLER_ENVIRONMENT}環境だけを対象にします。`,
    );
  }
}
