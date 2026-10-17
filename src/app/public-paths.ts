const PUBLIC_PATH_PREFIXES = ["/login", "/invitations/accept", "/oauth"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
