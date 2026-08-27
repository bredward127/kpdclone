export function isFalAdministrator(userId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const allowlist = (env.FAL_ADMIN_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return allowlist.includes(userId);
}
